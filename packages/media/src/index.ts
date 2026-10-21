/* @maleo/media — generated-media domain: image and tts.
 *
 * Layers:
 *   api/         the centralized client the dashboard uses (transport hidden)
 *   providers/   swappable, user-selectable provider impls (BrowserOS, …) + selection
 *   generation/  durable Inngest orchestration (function + runtime seam + store)
 *   worker.ts    the deployable host (apps/media-worker boots it)
 *
 * See docs/decisions/0002-content-provider-abstraction.md. */
export * from "./api/client.ts";
export * from "./api/types.ts";
export * from "./providers/index.ts";
export {
	registerGenerationRuntime,
	getGenerationRuntime,
	type GenerationRuntime,
} from "./generation/runtime.ts";
export { mediaFunctions, generationRun } from "./generation/function.ts";
export { registerWorkerRuntime } from "./generation/impl.ts";
export { startMediaWorker, buildMediaApp } from "./worker.ts";
