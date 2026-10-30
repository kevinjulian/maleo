# Initial codec validation

Task 2.3, run 2026-10-27 with installed MediaBunny 1.45.0.
See `codec-matrix-chromium.json` and `codec-matrix-webkit.json` for actual
results, browser versions, fixture hashes and decoder counts.

```sh
bun run --cwd apps/web playwright test --project=visual preview-codecs.spec.ts preview-source-loading.spec.ts --workers=1
MEDIA_CODEC_BROWSER=webkit bun run --cwd apps/web playwright test --project=visual preview-codecs.spec.ts --workers=1
```

Chromium 151.0.7922.34: three tests passed, including warmup. WebKit 26.5:
two tests passed, including warmup. Each source passed through the production
source worker, complete local storage and actual initial sample decoding.

| Fixture                            | Chromium                        | WebKit                          |
| ---------------------------------- | ------------------------------- | ------------------------------- |
| CFR H.264/AAC MP4                  | Decoded                         | Decoded                         |
| VFR silent H.264 MP4               | Decoded                         | Decoded                         |
| Nonzero-timestamp silent H.264 MP4 | Decoded                         | Decoded                         |
| VP9 WebM                           | Decoded                         | Named unsupported-codec failure |
| 44100/48000 Hz PCM WAVE            | Decoded                         | Decoded                         |
| PNG image                          | Decoded                         | Decoded                         |
| FFV1 Matroska                      | Named unsupported-codec failure | Named unsupported-codec failure |
| Malformed bytes                    | Named container failure         | Named container failure         |
| Silent video used as audio         | Named missing-track failure     | Named missing-track failure     |

Codec constructors were instrumented in the test worker. Maximum active video
and audio decoders were each one. Both counts were zero when each probe
completed. The initial `getSample()` version failed this check because its
background decoder pump closes after the sample returns. Draining the public
single-timestamp iterator now waits for closure before advancing the probe queue.

WebKit's private test context exposed OPFS but rejected opening its root with
`UnknownError`, before any directory or file existed. A standalone platform
probe reproduced that failure. Unavailable-root fallback now uses the specified
64 MiB memory backend. Explicit quota exhaustion remains a blocker. The memory
fallback and quota distinction have a portable regression test.

An earlier WebKit run also hit the existing HAR-backed editor's `503:
api_unreachable`. Codec tests now use a same-origin standalone test shell and
the production worker asset. This proves worker codec behavior, not WebKit
editor reachability or physical Safari/iPhone acceptance. The initial simultaneous
browser commands collided on the suite-owned port; recorded passing commands
ran serially.

The FFV1 fixture is generated from the CFR fixture using:

```sh
ffmpeg -v error -y -i cfr-av.mp4 -an -c:v ffv1 -threads 1 unsupported.mkv
```

Images receive a disposable initial decode only. HLS is excluded because a
playlist cannot establish complete-source residency for referenced segments.
Successful initial samples do not prove every later packet is valid.
