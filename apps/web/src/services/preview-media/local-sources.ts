import type { VideoMetadata } from "@models/timeline/preview-video-protocol.ts";
import type { AudioMetadata } from "@models/timeline/preview-audio-protocol.ts";

export interface LocalPreviewSource {
	id: string;
	revision: string;
	file: File;
	video: VideoMetadata | null;
	audio: AudioMetadata | null;
}
interface Entry {
	source: LocalPreviewSource;
	consumers: Set<() => Promise<void>>;
}
// Preview-only object URLs identify session-owned bytes; authored URLs never enter this registry.
const entries = new Map<string, Entry>();

export function registerLocalPreviewSource(url: string, source: LocalPreviewSource) {
	if (entries.has(url)) throw new Error("Local preview URL already has an owner");
	const entry: Entry = { source, consumers: new Set() };
	entries.set(url, entry);
	let removal: Promise<void> | undefined;
	return () => {
		if (removal) return removal;
		entries.delete(url);
		removal = Promise.all([...entry.consumers].map(async (dispose) => dispose())).then(() => {});
		return removal;
	};
}

/** File deletion waits for consumers to close their codecs and release borrowed bytes. */
export function borrowLocalPreviewSource(url: string, dispose: () => Promise<void>) {
	const entry = entries.get(url);
	if (!entry) throw new Error("Complete local preview source is unavailable");
	entry.consumers.add(dispose);
	return {
		source: entry.source,
		release: () => entry.consumers.delete(dispose),
	};
}
