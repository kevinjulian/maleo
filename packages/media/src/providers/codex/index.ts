/* Codex imagegen — `codex exec` running the `$imagegen` skill.
 *
 * The runner boundary is a spawned CLI, so this provider is `unconfigured`
 * rather than `down` on a machine without it, and an explicit selection fails
 * loudly instead of falling back. */
import type { ContentProvider, ImageProvider } from "../types.ts";
import { generateImageViaCodex } from "./image.ts";
import { codexMeta } from "./meta.ts";

const codexImage: ImageProvider = {
	async generate(input, ctx) {
		const result = await generateImageViaCodex({
			prompt: input.prompt,
			aspect: input.aspect,
			referenceUrls: input.referenceUrls,
			workspaceId: ctx.workspaceId,
			projectId: ctx.projectId,
			idempotencyKey: ctx.idempotencyKey,
			signal: ctx.signal,
		});
		return { url: result.path, fromCache: result.from_cache };
	},
};

export const codexProvider: ContentProvider = {
	meta: codexMeta,
	image: codexImage,
};

export {
	CODEX_CLI_COMMAND,
	CODEX_IMAGE_FEATURE,
	CODEX_IMAGE_SKILL,
	CODEX_PROVIDER_ID,
	RUNNER_MODEL_ENV,
	RUNNER_TIMEOUT_ENV,
	codexCliPath,
	codexImageModel,
	codexImageTimeoutMs,
} from "./constants.ts";
export {
	CodexCliUnavailableError,
	buildCodexImageArgs,
	buildCodexImagePrompt,
	parseCodexOutputPath,
	type CodexImageRequest,
} from "./cli.ts";
export { MAX_REFERENCES, resolveCodexReferences } from "./references.ts";
export { codexImageHealth, type CodexHealth } from "./health.ts";
export {
	codexImageCacheKey,
	generateImageViaCodex,
	normalizeCodexPrompt,
	type CodexImageInput,
	type CodexImageResult,
} from "./image.ts";
