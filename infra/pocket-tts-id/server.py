"""Pocket TTS Indonesian — stateless speech synthesis over HTTP.

The client lives in packages/media/src/providers/pocket-tts-id/, and the
configured service URL is the only wiring between the two.

STATELESS BY DESIGN. The voice prompt arrives with each request rather than
living in a registry here. A registry on this box would make the voice
catalogue dynamic and fetched, put operator recordings on storage the
application does not back up, and give a clone two places to exist and
disagree. The clone library is the application's, in its database; this
service only speaks.
"""

import asyncio
import io
import logging
import os
import subprocess
import tempfile
import threading
import wave

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pocket_tts import TTSModel

# The Indonesian 6-layer student, pinned to a published revision. The model card
# recommends it over the 24-layer teacher: 2.23x real time on CPU at 9.09%
# median WER. Overridable so a deploy can move the pin without a code change,
# but the default IS the contract the client's catalogue was written against.
MODEL_CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml"
    "@17257664e384561c957b02ac92edd1a24807f0e5",
)

# -6.0, not the library default of -4.0. The model card states this value is
# what delivers the published WER on the evaluation set, so it belongs to the
# model rather than to a caller: a client knob here would let a request quietly
# opt out of the only setting the model was measured at.
EOS_THRESHOLD = float(os.environ.get("POCKET_TTS_EOS_THRESHOLD", "-6.0"))

# Integrated loudness the returned speech is levelled to, in LUFS.
#
# The model reproduces the LEVEL of its voice prompt, so a quiet recording
# clones into quiet narration — one real prompt came back at -38 dBFS peak,
# roughly thirty decibels under the clips the other providers return, which in a
# timeline reads as a broken clip rather than a quiet one.
#
# -24 rather than the -16 a broadcast preset would suggest: it is measured
# against what this application's existing speech clips actually sit at (-7 to
# -10 dBFS peak), because narration from two providers has to mix in one
# timeline. A house level beats a standard that disagrees with the house.
LOUDNESS_TARGET_LUFS = float(os.environ.get("POCKET_TTS_LOUDNESS_LUFS", "-24"))

# Ceiling for the true peak, leaving room for the encode that follows.
LOUDNESS_PEAK_DBTP = -1.5

logger = logging.getLogger("pocket-tts-id")

app = FastAPI(title="pocket-tts-id")

# Loaded once at import, before the first request: load_model() is slow and the
# weights are baked into the image, so paying it here means a container is
# either healthy or not, never healthy-but-cold.
_model = TTSModel.load_model(config=MODEL_CONFIG, eos_threshold=EOS_THRESHOLD)

# ponytail: one global lock. The model holds decode state and is not safe to
# drive from two requests at once; a single server serialises generation. If
# throughput matters, the upgrade is a small pool of model instances, not a
# finer lock.
_lock = threading.Lock()


def _to_wav(audio: torch.Tensor, sample_rate: int) -> bytes:
    """PCM tensor to a 16-bit WAV container.

    The stdlib writer rather than scipy or soundfile: one output format, one
    sample width, and no dependency that exists to save six lines.
    """
    samples = audio.detach().cpu().numpy()
    clipped = np.clip(samples, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm16.tobytes())
    return buffer.getvalue()


def _normalize_prompt(src: str, dst: str) -> None:
    """Transcode any voice prompt to the one shape the model can always read.

    pocket-tts reads a 16-bit WAV with the standard library and hands ANYTHING
    ELSE to `soundfile`, an optional extra. Installing that extra would not be
    enough: soundfile wraps libsndfile, which has no M4A or AAC decoder, and a
    phone voice memo — the most likely recording anyone has — is exactly M4A.

    So the container normalizes instead of narrowing what it accepts. ffmpeg
    decodes what people actually record, and one conversion removes the optional
    dependency, the 16-bit special case, and the "please convert it yourself"
    answer at the same time.

    Mono because the model averages channels anyway. The sample rate is left
    alone: the model card recommends a high-rate prompt for a distinctive clone,
    so resampling here could only lose what it asks for.
    """
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-c:a", "pcm_s16le", dst],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        # ffmpeg's own words. "conversion failed" with no cause is what sends an
        # operator to guess at their file.
        raise ValueError(f"could not decode the voice prompt: {result.stderr.strip()[:400]}")


def _level(src: str, dst: str, sample_rate: int) -> None:
    """Level generated speech to the house loudness.

    `-ar` is not optional. ffmpeg's loudnorm filter resamples its output to
    192 kHz, so omitting the rate returns a file eight times the size at a rate
    the model never produced.
    """
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
            "-af", f"loudnorm=I={LOUDNESS_TARGET_LUFS}:TP={LOUDNESS_PEAK_DBTP}:LRA=11",
            "-ar", str(sample_rate), "-ac", "1", "-c:a", "pcm_s16le", dst,
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )


def _synthesize(text: str, prompt_path: str) -> bytes:
    with _lock:
        # get_state_for_audio_prompt runs per request because the service holds
        # no voice library. It is the slow half of a synthesis. If that shows up
        # in latency, the fix is an LRU here keyed by a hash of the prompt bytes
        # — the interface does not change.
        state = _model.get_state_for_audio_prompt(prompt_path)
        audio = _model.generate_audio(state, text)
        return _to_wav(audio, _model.sample_rate)


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness for the client's reachability probe and the platform's check.

    Reports the loaded config so a deploy that moved the pin is visible from
    outside the container rather than only in the build log.
    """
    return {"status": "ok", "config": MODEL_CONFIG, "sample_rate": _model.sample_rate}


@app.post("/v1/audio/speech")
async def speech(
    input: str = Form(...),
    voice_prompt: UploadFile = File(...),
    response_format: str = Form("wav"),
) -> Response:
    """Synthesize `input` in the voice of the supplied audio prompt.

    Multipart rather than JSON because the voice prompt is bytes. The OpenAI
    field name `input` is kept so the shape stays recognisable next to the
    other self-hosted TTS service, but `voice` is a file here, not a name:
    this model has no speaker ids to choose from.
    """
    text = input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is required")
    if response_format != "wav":
        # The model is band-limited to 16 kHz and this service encodes only WAV
        # on the way out. Refusing is honest; silently returning WAV under
        # another name would leave the caller decoding something it did not ask
        # for. (Prompts on the way IN are transcoded — see _normalize_prompt.)
        raise HTTPException(
            status_code=400,
            detail=f"unsupported response_format {response_format!r}; this service returns wav",
        )

    prompt_bytes = await voice_prompt.read()
    if not prompt_bytes:
        raise HTTPException(status_code=400, detail="voice_prompt is empty")

    suffix = os.path.splitext(voice_prompt.filename or "")[1] or ".wav"
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, f"prompt{suffix}")
        normalized = os.path.join(workdir, "prompt.16bit.wav")
        with open(source, "wb") as handle:
            handle.write(prompt_bytes)

        try:
            # Decoding is a subprocess and generation is CPU-bound; neither
            # belongs on the event loop.
            await asyncio.to_thread(_normalize_prompt, source, normalized)
        except ValueError as err:
            # The prompt is the caller's input, so an undecodable one is a 400.
            # It was a 502 before, which told an operator their file was our
            # outage.
            logger.warning("voice prompt rejected: %s", err)
            raise HTTPException(status_code=400, detail=str(err)) from err
        except Exception as err:
            logger.exception("normalizing the voice prompt failed")
            raise HTTPException(status_code=500, detail=f"could not prepare the voice prompt: {err}") from err

        try:
            wav = await asyncio.to_thread(_synthesize, text, normalized)
            raw = os.path.join(workdir, "speech.raw.wav")
            levelled = os.path.join(workdir, "speech.wav")
            with open(raw, "wb") as handle:
                handle.write(wav)
            try:
                await asyncio.to_thread(_level, raw, levelled, _model.sample_rate)
                with open(levelled, "rb") as handle:
                    wav = handle.read()
            except Exception:
                # Quiet audio beats no audio: the synthesis is already paid for
                # and the clip is correct, just under-levelled. Logged loudly
                # rather than passed off as a normal result.
                logger.exception("levelling failed; returning the un-levelled clip")
        except HTTPException:
            raise
        except Exception as err:  # noqa: BLE001 — logged, then reported
            # LOGGED BEFORE IT IS CONVERTED, which the first version did not do.
            # The detail travelled only in the response body, and the proxy in
            # front of this service replaces a 5xx body with its own error page —
            # so the only copy of the cause was thrown away and the container log
            # showed a bare "502" with the reason nowhere at all.
            logger.exception("synthesis failed")
            raise HTTPException(status_code=500, detail=f"synthesis failed: {err}") from err

    return Response(content=wav, media_type="audio/wav")
