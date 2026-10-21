import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CAPTION_JOB_LIMITS, effectiveMediaImportLimits } from "@maleo/shared";
import { SPEECH_UPLOAD_BYTES, SpeechOptionsSchema } from "../api/speech.ts";
import { mediaWorkerCacheDir } from "../paths.ts";
import { requireMediaService } from "../worker-auth.ts";
import { getLocalWhisperStatus, setupLocalWhisper, transcribeLocalWhisper } from "./whisper.ts";
import { probeImportedMedia } from "./probe.ts";

/** Generated narration enters as bounded bytes; imported media uses scoped jobs. */
export function speechRoutes(): Hono {
	const app = new Hono();
	app.use("*", requireMediaService);
	app.get("/status", async (c) => c.json(await getLocalWhisperStatus()));
	app.post("/setup", async (c) => {
		try {
			return c.json(await setupLocalWhisper());
		} catch (error) {
			console.error("[speech] setup", error);
			const reason = error instanceof Error ? error.message : String(error);
			return c.json({ error: `Whisper setup failed on media worker: ${reason}` }, 503);
		}
	});
	let active = false;
	app.post("/", bodyLimit({ maxSize: SPEECH_UPLOAD_BYTES + 128 * 1024 }), async (c) => {
		if (active) return c.json({ error: "Speech worker busy; retry narration step" }, 409);
		const body = await c.req.parseBody().catch(() => null);
		let rawOptions: unknown;
		try {
			rawOptions = typeof body?.options === "string" ? JSON.parse(body.options) : null;
		} catch {
			return c.json({ error: "Invalid speech options" }, 400);
		}
		const options = SpeechOptionsSchema.safeParse(rawOptions);
		const audio = body?.audio;
		if (
			!options.success ||
			!(audio instanceof File) ||
			!audio.size ||
			audio.size > SPEECH_UPLOAD_BYTES
		)
			return c.json({ error: "Invalid speech request" }, 400);
		if (active) return c.json({ error: "Speech worker busy; retry narration step" }, 409);
		active = true;
		let directory: string | undefined;
		try {
			const cache = mediaWorkerCacheDir();
			await mkdir(cache, { recursive: true });
			directory = await mkdtemp(join(cache, "speech-"));
			const input = join(directory, "source.wav");
			await Bun.write(input, audio);
			const signal = AbortSignal.any([
				c.req.raw.signal,
				AbortSignal.timeout(CAPTION_JOB_LIMITS.timeoutMs),
			]);
			await probeImportedMedia(
				input,
				{ kind: "audio", originalFilename: "speech.wav" },
				audio.size,
				effectiveMediaImportLimits({ maxSourceDurationSec: CAPTION_JOB_LIMITS.maxDurationSec }),
				signal,
			);
			return c.json(await transcribeLocalWhisper({ audioPath: input, ...options.data, signal }));
		} catch (error) {
			console.error("[speech] recognition", error);
			return c.json({ error: "Speech recognition failed on media worker; retry" }, 503);
		} finally {
			active = false;
			if (directory) await rm(directory, { recursive: true, force: true });
		}
	});
	return app;
}
