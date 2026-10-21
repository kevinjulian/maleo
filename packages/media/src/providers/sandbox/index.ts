/* The local mock: an SVG-derived image, WAV, and four-second MP4, no external service.
 *
 * It exists so the whole pipeline can run without credentials — the worker
 * serves the file, the client polls it, the ledger records it. Its readiness is
 * gated on `MALEO_SANDBOX=1` for image/TTS; video is explicitly selected. */
import type { ContentProvider, ImageProvider, TtsProvider } from "../types.ts";
import { generateSandboxImage } from "./image.ts";
import { sandboxMeta } from "./meta.ts";
import { generateSpeechViaSandbox } from "./tts.ts";
import { sandboxVideo } from "./video.ts";

const sandboxImage: ImageProvider = {
	async generate(input) {
		const result = await generateSandboxImage({ prompt: input.prompt, aspect: input.aspect });
		return { url: result.path, fromCache: false };
	},
};

const sandboxTts: TtsProvider = {
	async synthesize(input) {
		const result = await generateSpeechViaSandbox(input.text, input.voice);
		return { path: result.path, fromCache: result.from_cache };
	},
};

export const sandboxProvider: ContentProvider = {
	meta: sandboxMeta,
	image: sandboxImage,
	tts: sandboxTts,
	video: sandboxVideo,
};

export {
	createSandboxSvg,
	generateSandboxImage,
	resolveSandboxDimensions,
	type SandboxImageInput,
	type SandboxImageResult,
} from "./image.ts";
export {
	createSandboxWav,
	generateSpeechViaSandbox,
	sandboxSpeechSeconds,
	type SandboxTtsResult,
} from "./tts.ts";
