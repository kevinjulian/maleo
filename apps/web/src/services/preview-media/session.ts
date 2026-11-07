import { z } from "zod";
import { editorEngine } from "@maleo/shared/editor";
import type { PreviewMediaDependencies, PreviewMediaSource } from "@maleo/shared";
import { createPreviewSourceClient } from "./source-client.ts";
import { registerLocalPreviewSource } from "./local-sources.ts";

const state = z.discriminatedUnion("state", [
	z.object({ state: z.literal("queued") }),
	z.object({ state: z.literal("loading"), loaded: z.number(), total: z.number().nullable() }),
	z.object({ state: z.literal("validating") }),
	z.object({ state: z.literal("ready") }),
	z.object({ state: z.literal("failed"), message: z.string() }),
]);
const snapshot = z.object({
	generation: z.number(),
	ready: z.boolean(),
	sources: z.record(z.string(), state),
	clips: z.array(
		z.object({
			id: z.string(),
			state,
			loaded: z.number(),
			total: z.number().nullable(),
			blockers: z.array(z.string()),
		}),
	),
});
const request = z.object({
	generation: z.number(),
	sourceId: z.string(),
	revision: z.string(),
	attempt: z.number(),
});
const response = z.object({ accepted: z.boolean(), snapshot, requests: z.array(request) });
export type MediaReadiness = z.infer<typeof snapshot>;
type Request = z.infer<typeof request>;
const sessions = new Set<PreviewMediaSession>();

/** Sign-out waits for owned downloads, decoder probes and temporary-file cleanup. */
export async function disposePreviewMediaSessions(): Promise<void> {
	const results = await Promise.allSettled([...sessions].map((session) => session.dispose()));
	for (const result of results)
		if (result.status === "rejected") console.error("Preview media cleanup failed", result.reason);
}

/** Rust owns readiness. This session owns only adapter work and preview-local URLs. */
export function createPreviewMediaSession(options: {
	resolve: Parameters<typeof createPreviewSourceClient>[0]["resolve"];
	changed(): void;
	stop?(): void;
}) {
	const engine = editorEngine();
	const handle = engine.mediaOpen();
	const urls = new Map<
		string,
		{ source: PreviewMediaSource; url: string; remove(): Promise<void> }
	>();
	const releases = new Map<string, Promise<void>>();
	const pendingReleases = new Set<Promise<void>>();
	const requests = new Map<string, Request>();
	let sources: PreviewMediaSource[] = [];
	let definition = "";
	let disposed = false;
	let closed: Promise<void> | undefined;
	let readiness: MediaReadiness;
	function dispatch(action: unknown) {
		const result = engine.mediaDispatch(handle, JSON.stringify(action));
		if (!result.ok) throw new Error(result.error.message);
		const parsed = response.parse(JSON.parse(result.value));
		readiness = parsed.snapshot;
		return parsed;
	}
	readiness = dispatch({ type: "snapshot" }).snapshot;
	function complete(token: Request, completion: unknown) {
		if (disposed) return false;
		const result = dispatch({ type: "complete", request: token, completion });
		if (result.accepted) options.changed();
		return result.accepted;
	}
	const client = createPreviewSourceClient({
		resolve: options.resolve,
		failed: (message) => {
			for (const token of requests.values()) invalidate(token, message);
		},
		progress: (source, { loaded, total }) => {
			const token = requests.get(source.id);
			if (token && token.revision === source.revision)
				complete(token, { type: "progress", loaded, total });
		},
		validating: (source) => {
			const token = requests.get(source.id);
			if (token && token.revision === source.revision) complete(token, { type: "validating" });
		},
	});
	function invalidate(token: Request, message: string) {
		if (disposed) return;
		if (dispatch({ type: "invalidate", request: token, message }).accepted) {
			const source = sources.find((item) => item.id === token.sourceId);
			if (source) void release(source);
			options.changed();
		}
	}

	function trackRelease(id: string, task: Promise<void>) {
		releases.set(id, task);
		pendingReleases.add(task);
		void task
			.catch((error) => console.error("Preview source consumer cleanup failed", error))
			.finally(() => {
				pendingReleases.delete(task);
				if (releases.get(id) === task) releases.delete(id);
			});
		return task;
	}
	function revoke(id: string): Promise<void> {
		const held = urls.get(id);
		if (!held) return releases.get(id) ?? Promise.resolve();
		options.stop?.();
		urls.delete(id);
		URL.revokeObjectURL(held.url);
		return trackRelease(id, held.remove());
	}
	function release(source: PreviewMediaSource) {
		return trackRelease(
			source.id,
			revoke(source.id).then(() => client.release(source)),
		);
	}
	function start(pending: Request[], files: ReadonlyMap<string, File>) {
		for (const token of pending) {
			const source = sources.find((item) => item.id === token.sourceId)!;
			requests.set(source.id, token);
			void (async () => {
				await releases.get(source.id);
				if (disposed || requests.get(source.id) !== token)
					throw new DOMException("Preview source request cancelled", "AbortError");
				return client.load(source, files.get(source.url));
			})().then(
				(file) => {
					if (disposed || requests.get(source.id) !== token) return;
					let url: string;
					try {
						url = URL.createObjectURL(file);
					} catch {
						complete(token, {
							type: "failed",
							message: "Local preview source is unavailable. Retry this source.",
						});
						return;
					}
					const accepted = complete(token, {
						type: "ready",
						eof: true,
						readable: true,
						bytes: file.size,
						expected: file.size,
						validated: true,
						decoded: true,
					});
					if (!accepted) {
						URL.revokeObjectURL(url);
						return;
					}
					void revoke(source.id);
					const remove = registerLocalPreviewSource(url, {
						id: source.id,
						revision: source.revision,
						file,
						video: client.metadata(source) ?? null,
						audio: client.audioMetadata(source) ?? null,
					});
					urls.set(source.id, { source, url, remove });
					options.changed();
				},
				(error) => {
					if (requests.get(source.id) === token)
						complete(token, {
							type: "failed",
							message: error instanceof Error ? error.message : "Preview source failed",
						});
				},
			);
		}
	}
	const session = {
		isOpen: () => !disposed,
		definition: () => definition,
		snapshot: () => readiness,
		/** The URL of every source the current dependencies name. */
		sourceUrls: (): string[] => sources.map((source) => source.url),
		resolve(url: string): string | undefined {
			const source = sources.find((item) => item.url === url);
			if (!source || readiness.sources[source.id]?.state !== "ready") return undefined;
			return urls.get(source.id)?.url;
		},
		update(dependencies: PreviewMediaDependencies, files: ReadonlyMap<string, File> = new Map()) {
			if (disposed) return;
			const result = dispatch({ type: "update", dependencies });
			definition = JSON.stringify(dependencies);
			for (const old of sources) {
				const next = dependencies.sources.find((item) => item.id === old.id);
				if (!next || next.revision !== old.revision || next.url !== old.url) {
					void release(old);
					requests.delete(old.id);
				} else if (result.snapshot.sources[old.id]?.state !== "ready") void revoke(old.id);
			}
			for (const [id, token] of requests) {
				if (result.snapshot.sources[id]?.state === "ready")
					requests.set(id, { ...token, generation: result.snapshot.generation });
			}
			sources = dependencies.sources;
			start(result.requests, files);
			options.changed();
		},
		invalidate(sourceId: string, message: string) {
			const token = requests.get(sourceId);
			if (token) invalidate(token, message);
		},
		retry(sourceId: string, files: ReadonlyMap<string, File> = new Map()) {
			if (disposed) return;
			const result = dispatch({ type: "retry", sourceId });
			start(result.requests, files);
			options.changed();
		},
		dispose(): Promise<void> {
			if (closed) return closed;
			disposed = true;
			options.stop?.();
			options.changed();
			sessions.delete(session);
			requests.clear();
			for (const id of urls.keys()) void revoke(id);
			const native = engine.mediaClose(handle);
			// A failed consumer release is already logged; it must not skip worker and storage cleanup.
			closed = Promise.allSettled([...pendingReleases])
				.then(() => client.dispose())
				.then(() => {
					if (!native.ok) throw new Error(native.error.message);
				});
			return closed;
		},
	};
	sessions.add(session);
	return session;
}
export type PreviewMediaSession = ReturnType<typeof createPreviewMediaSession>;
