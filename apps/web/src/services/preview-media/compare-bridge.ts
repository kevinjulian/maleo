import type { PreviewWorkerLike } from "@models/timeline/preview-client.ts";
import type {
	PreviewMediaBinding,
	PreviewMediaEvent,
	PreviewRequest,
} from "@models/timeline/preview-protocol.ts";
import { openDecoderLeases } from "./decoder-leases.ts";
import { borrowLocalPreviewSource } from "./local-sources.ts";

/** Files stay leased until the renderer closes its child decoders and acknowledges removal. */
export function createCompareMediaBridge(
	worker: PreviewWorkerLike,
	onError: (message: string) => void,
	beforeRelease?: () => Promise<void>,
) {
	const owners = new Map<number, ReturnType<typeof openDecoderLeases>>();
	const sources = new Map<string, ReturnType<typeof borrowLocalPreviewSource>>();
	const releasing = new Map<string, Promise<void>>();
	const acknowledgements = new Map<number, () => void>();
	let ended = false;
	let nextRequest = 0,
		stopped: Promise<void> | undefined,
		finishStop: (() => void) | undefined;
	function post(message: PreviewRequest) {
		if (ended) return;
		try {
			worker.postMessage(message, []);
		} catch (error) {
			worker.terminate();
			finish();
			onError(error instanceof Error ? error.message : "Compare media worker failed");
		}
	}
	function finish() {
		if (ended) return;
		ended = true;
		stopped ??= Promise.resolve();
		for (const owner of owners.values()) owner.close();
		owners.clear();
		for (const acknowledge of acknowledgements.values()) acknowledge();
		acknowledgements.clear();
		for (const source of sources.values()) source.release();
		sources.clear();
		finishStop?.();
	}
	function release(url: string): Promise<void> {
		const held = sources.get(url);
		if (!held) return releasing.get(url) ?? Promise.resolve();
		if (stopped)
			return stopped.then(() => {
				held.release();
			});
		sources.delete(url);
		const requestId = ++nextRequest;
		const promise = new Promise<void>((resolve) => acknowledgements.set(requestId, resolve)).then(
			() => {
				held.release();
				releasing.delete(url);
			},
		);
		releasing.set(url, promise);
		const request = () => post({ type: "source-release", url, requestId });
		if (beforeRelease)
			void Promise.resolve()
				.then(beforeRelease)
				.then(request, (error: unknown) => {
					worker.terminate();
					finish();
					onError(error instanceof Error ? error.message : "Compare audio cleanup failed");
				});
		else request();
		return promise;
	}
	return {
		bindings(urls: readonly string[]): PreviewMediaBinding[] {
			if (stopped) return [];
			const next = new Set(urls);
			for (const url of sources.keys()) if (!next.has(url)) void release(url);
			const bindings: PreviewMediaBinding[] = [];
			for (const url of next) {
				let held = sources.get(url);
				if (!held) {
					try {
						held = borrowLocalPreviewSource(url, () => release(url));
					} catch {
						continue;
					}
					sources.set(url, held);
				}
				bindings.push({ url, ...held.source });
			}
			return bindings;
		},
		handle(event: PreviewMediaEvent) {
			if (ended) return;
			switch (event.type) {
				case "audio-ready":
				case "audio-started":
				case "audio-block":
				case "audio-failed":
				case "pcm-reserved":
					return;
				case "decoder-request": {
					let owner = owners.get(event.owner);
					if (!owner) {
						owner = openDecoderLeases((lease) =>
							post({ type: "decoder-yield", owner: event.owner, lease }),
						);
						owners.set(event.owner, owner);
					}
					void owner.request(event.kind, event.slots).then(
						(lease) =>
							post({ type: "decoder-grant", owner: event.owner, request: event.request, lease }),
						(error: unknown) =>
							post({
								type: "decoder-reject",
								owner: event.owner,
								request: event.request,
								message: error instanceof Error ? error.message : "Decoder lease failed",
							}),
					);
					return;
				}
				case "decoder-return":
					owners.get(event.owner)?.release(event.lease);
					return;
				case "decoder-close":
					owners.get(event.owner)?.close();
					owners.delete(event.owner);
					return;
				case "source-released":
					acknowledgements.get(event.requestId)?.();
					acknowledgements.delete(event.requestId);
					return;
				case "disposed":
					return finish();
			}
		},
		dispose(): Promise<void> {
			if (stopped) return stopped;
			stopped = new Promise<void>((resolve) => {
				finishStop = resolve;
			});
			post({ type: "dispose" });
			return stopped;
		},
		/** Terminate the renderer worker and its children before releasing native slots. */
		terminated() {
			finish();
		},
	};
}
