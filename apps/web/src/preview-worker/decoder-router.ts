import type { PreviewMediaEvent, PreviewRequest } from "@models/timeline/preview-protocol.ts";
import type { openDecoderLeases } from "@services/preview-media/decoder-leases.ts";

interface Waiting {
	resolve(lease: number): void;
	reject(error: Error): void;
}
interface Owner {
	pending: Map<number, Waiting>;
	yield(lease: number): void;
}

/** Routing only. The main-thread editor WASM owns grants across all media workers. */
export function createWorkerDecoderRouter(post: (event: PreviewMediaEvent) => void) {
	const owners = new Map<number, Owner>();
	let nextOwner = 0;
	const open = (
		onYield: (lease: number) => void = () => {},
	): ReturnType<typeof openDecoderLeases> => {
		const id = ++nextOwner;
		const owner: Owner = { pending: new Map(), yield: onYield };
		owners.set(id, owner);
		let nextRequest = 0,
			closed = false;
		return {
			request(kind, slots = 1) {
				if (closed) return Promise.reject(new Error("Decoder owner is closed"));
				const request = ++nextRequest;
				const pending = new Promise<number>((resolve, reject) =>
					owner.pending.set(request, { resolve, reject }),
				);
				post({ type: "decoder-request", owner: id, request, kind, slots });
				return pending;
			},
			release(lease) {
				if (!closed) post({ type: "decoder-return", owner: id, lease });
			},
			close() {
				if (closed) return;
				closed = true;
				owners.delete(id);
				for (const waiting of owner.pending.values())
					waiting.reject(new Error("Decoder owner is closed"));
				owner.pending.clear();
				post({ type: "decoder-close", owner: id });
			},
		};
	};
	return {
		open,
		handle(message: PreviewRequest): boolean {
			if (message.type === "decoder-yield") {
				owners.get(message.owner)?.yield(message.lease);
				return true;
			}
			if (message.type !== "decoder-grant" && message.type !== "decoder-reject") return false;
			const owner = owners.get(message.owner),
				waiting = owner?.pending.get(message.request);
			owner?.pending.delete(message.request);
			if (message.type === "decoder-grant") {
				if (waiting) waiting.resolve(message.lease);
				else post({ type: "decoder-return", owner: message.owner, lease: message.lease });
			} else waiting?.reject(new Error(message.message));
			return true;
		},
	};
}
