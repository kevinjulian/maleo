/* What this environment can actually do.
 *
 * Asked once, at the boundary, rather than by each caller guarding its own
 * `typeof` check. The media pipeline in particular has to report an absent
 * capability to the consumer rather than fall back to the main thread, so
 * "can this environment decode off-thread" needs one answer everything shares.
 */

/** Whether a document exists to paint into and take pointer capture on. */
export function hasDom(): boolean {
	return typeof globalThis.document !== "undefined" && typeof globalThis.window !== "undefined";
}

/** Whether summaries can be produced off the main thread. */
export function hasWorker(): boolean {
	return typeof globalThis.Worker === "function";
}

/**
 * Whether frames can be demuxed and decoded directly, rather than seek-and-drawn.
 *
 * `VideoDecoder` is read off `globalThis` by name rather than through a shape
 * asserted onto it: the whole question is whether the environment provides it,
 * and an assertion saying it might would be answering that question with
 * itself.
 */
export function hasWebCodecs(): boolean {
	return typeof globalThis.VideoDecoder === "function";
}

/** Whether audio can be decoded at all, in a worker or otherwise. */
export function hasAudioDecoding(): boolean {
	return (
		typeof globalThis.AudioContext === "function" ||
		typeof globalThis.OfflineAudioContext === "function"
	);
}

/** Everything the layers above need to decide what they can offer. */
export interface EnvironmentCapabilities {
	readonly dom: boolean;
	readonly worker: boolean;
	readonly webCodecs: boolean;
	readonly audioDecoding: boolean;
}

/** Read every capability at once, so a surface decides its shape in one place. */
export function environmentCapabilities(): EnvironmentCapabilities {
	return {
		dom: hasDom(),
		worker: hasWorker(),
		webCodecs: hasWebCodecs(),
		audioDecoding: hasAudioDecoding(),
	};
}
