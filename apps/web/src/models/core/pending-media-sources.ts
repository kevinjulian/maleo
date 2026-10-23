/* The session's sources for media still importing (`use-media-while-uploading` D2).
 *
 * A document references a file chosen for import by its client-minted media URL,
 * `/api/media/<id>`, final from the moment of import (`p1-asset-identity`). Until
 * its import is ready it plays from the browser's copy; once ready, from the
 * server. Completion is resolution, not an edit: nothing
 * here touches the document or the undo ledger, so undoing into a state recorded
 * while pending still plays the managed media, and redo is never cleared by an
 * upload finishing.
 *
 * Pure bookkeeping over strings. The import hook creates and revokes the object URLs;
 * this module only hands back the ones that stopped being needed. */
import { isMediaId, mediaUrlId, type ReadyImportedMedia } from "@maleo/shared";

interface PendingSource {
	local?: string;
	ready?: ReadyImportedMedia;
}

const sources = new Map<string, PendingSource>();
const listeners = new Set<() => void>();
let version = 0;

const changed = (): void => {
	version++;
	for (const listener of listeners) listener();
};

export function subscribePendingSources(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Changes whenever any source does; a memo keyed on it re-resolves. */
export function pendingSourcesVersion(): number {
	return version;
}

/** The session key a media URL resolves through: its client-minted media id, which
 *  is also its import's request key. */
export function pendingSourceKey(url: unknown): string | undefined {
	const id = mediaUrlId(url);
	return isMediaId(id) ? id : undefined;
}

/** Whether a URL names a file whose import this session tracks and has not finished. */
export function isPendingMedia(url: unknown): boolean {
	const key = pendingSourceKey(url);
	const source = key ? sources.get(key) : undefined;
	return Boolean(source && !source.ready);
}

/** An upload asset the server has not confirmed: a minted URL saved without the
 *  imported provenance a finished import records. */
export function awaitsImport(asset: {
	url: string;
	source?: string;
	importedSource?: unknown;
}): boolean {
	return asset.source === "upload" && !asset.importedSource && isMediaId(mediaUrlId(asset.url));
}

/** The distinct files still importing that `value` references anywhere. */
export function pendingMediaKeys(value: unknown): Set<string> {
	const keys = new Set<string>();
	const visit = (item: unknown): void => {
		if (typeof item === "string") {
			const key = pendingSourceKey(item);
			if (key && isPendingMedia(item)) keys.add(key);
		} else if (Array.isArray(item)) item.forEach(visit);
		else if (item && typeof item === "object") Object.values(item).forEach(visit);
	};
	visit(value);
	return keys;
}

/** Hold a loaded document's unfinished import as pending before any local copy exists,
 *  so the preview loads nothing rather than reading the server's `409 media_pending`. */
export function trackPendingSource(key: string): void {
	if (sources.has(key)) return;
	sources.set(key, {});
	changed();
}

export function setPendingLocalUrl(key: string, url: string): void {
	sources.set(key, { ...sources.get(key), local: url });
	changed();
}

/** Record the ready import. Answers with the local URL that is no longer needed. */
export function setPendingReady(key: string, asset: ReadyImportedMedia): string | undefined {
	const local = sources.get(key)?.local;
	sources.set(key, { ready: asset });
	changed();
	return local;
}

/** Forget one source (cancel, remove). Answers with its local URL to revoke. */
export function removePendingSource(key: string): string | undefined {
	const local = sources.get(key)?.local;
	if (sources.delete(key)) changed();
	return local;
}

/** Forget every source (project switch). Answers with the local URLs to revoke. */
export function clearPendingSources(): string[] {
	const locals = [...sources.values()].flatMap((source) => (source.local ? [source.local] : []));
	sources.clear();
	if (uploadStates.size) {
		uploadStates.clear();
		uploadChanged();
	}
	changed();
	return locals;
}

export function readyPendingImport(url: unknown): ReadyImportedMedia | undefined {
	const key = pendingSourceKey(url);
	return key ? sources.get(key)?.ready : undefined;
}

/** Any media URL as the browser should load it: a pending reference becomes its
 *  ready URL, else its local copy, else empty (nothing to load yet). A minted URL
 *  this session does not track is ordinary stored media. */
export function resolveMediaUrl(url: string): string {
	const key = pendingSourceKey(url);
	if (!key) return url;
	const source = sources.get(key);
	if (!source) return url;
	return source.ready?.url ?? source.local ?? "";
}

/** A pending asset once its import is ready: same identity and label, the server's
 *  URL, poster and measured metadata. Unchanged while still pending. */
export function resolvePendingAsset<T extends { url: string }>(asset: T): T {
	const ready = readyPendingImport(asset.url);
	if (!ready) return asset;
	return {
		...asset,
		url: ready.url,
		...(ready.thumb ? { thumb: ready.thumb } : {}),
		...(ready.dur ? { dur: ready.dur } : {}),
		metadata: ready.metadata,
		compatibility: ready.compatibility,
		importedSource: ready.importedSource,
	};
}

function substitute<T>(value: T, url: (pending: string) => string | undefined): T {
	const visit = (item: unknown): unknown => {
		if (typeof item === "string") return pendingSourceKey(item) ? (url(item) ?? item) : item;
		if (Array.isArray(item)) return item.map(visit);
		if (!item || typeof item !== "object") return item;
		// An asset (it records its source) takes the ready metadata, not just the URL.
		const base: object =
			"url" in item && typeof item.url === "string" && "source" in item
				? resolvePendingAsset({ ...item, url: item.url })
				: item;
		return Object.fromEntries(Object.entries(base).map(([key, field]) => [key, visit(field)]));
	};
	// SAFETY: only pending media strings and pending assets' URL and metadata change; every other value keeps its shape.
	return visit(value) as T;
}

/** What a save writes: ready references take managed URLs and metadata; the ones
 *  still pending keep their stable reference, never a browser-local URL. */
export function withReadyPending<T>(value: T): T {
	return substitute(value, (pending) => readyPendingImport(pending)?.url);
}

/** What the preview plays: every pending reference as the browser can load it now. */
export function withResolvedPending<T>(value: T): T {
	return substitute(value, resolveMediaUrl);
}

/* ── Upload state per pending asset, for its card and every clip that uses it ──
 * Kept apart from the sources: progress changes many times a second, and only the
 * surfaces showing one asset's state should re-render for it. */

export type PendingUploadState =
	| { phase: "uploading"; progress: number }
	| { phase: "processing" }
	| { phase: "failed"; reason: string; canRetry: boolean }
	| { phase: "interrupted" };

const uploadStates = new Map<string, PendingUploadState>();
const uploadListeners = new Set<() => void>();
let uploadVersion = 0;
const uploadChanged = (): void => {
	uploadVersion++;
	for (const listener of uploadListeners) listener();
};

/** Changes whenever any asset's upload state does, for a surface listing many. */
export function pendingUploadsVersion(): number {
	return uploadVersion;
}

export function subscribePendingUploadStates(listener: () => void): () => void {
	uploadListeners.add(listener);
	return () => {
		uploadListeners.delete(listener);
	};
}

/** Publish one asset's state; `undefined` once it is ready or gone. */
export function setPendingUploadState(key: string, state: PendingUploadState | undefined): void {
	const before = uploadStates.get(key);
	if (before === state || (before && state && JSON.stringify(before) === JSON.stringify(state)))
		return;
	if (state) uploadStates.set(key, state);
	else uploadStates.delete(key);
	uploadChanged();
}

/** The state of the pending asset a media URL references; stable until it changes. */
export function pendingUploadStateOf(url: unknown): PendingUploadState | undefined {
	const key = pendingSourceKey(url);
	return key ? uploadStates.get(key) : undefined;
}

/** What a card, clip or sheet says about the state, and its accessible name. */
export function pendingUploadLabel(state: PendingUploadState): string {
	if (state.phase === "uploading") return `Uploading ${Math.floor(state.progress * 100)}%`;
	if (state.phase === "processing") return "Processing";
	if (state.phase === "failed") return `Upload failed: ${state.reason}`;
	return "Upload interrupted";
}
