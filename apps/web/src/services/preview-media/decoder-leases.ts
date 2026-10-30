import { z } from "zod";
import { editorEngine } from "@maleo/shared/editor";

const grants = z.array(
	z.object({
		owner: z.number().int().positive(),
		request: z.number().int().positive(),
		lease: z.number().int().positive(),
	}),
);
interface Waiting {
	resolve(lease: number): void;
	reject(error: Error): void;
}
interface Owner {
	pending: Map<number, Waiting>;
	active: Set<number>;
	notified: Set<number>;
	yield(lease: number): void;
}
const owners = new Map<number, Owner>();

/** Routing only: Rust grants slots and requests yielding across workers in this tab. */
function deliver(): void {
	const engine = editorEngine();
	while (true) {
		const result = engine.decoderGrants();
		if (!result.ok) throw new Error(result.error.message);
		const ready = grants.parse(JSON.parse(result.value));
		if (!ready.length) break;
		for (const grant of ready) {
			const owner = owners.get(grant.owner),
				waiting = owner?.pending.get(grant.request);
			owner?.pending.delete(grant.request);
			if (waiting && owner) {
				owner.active.add(grant.lease);
				waiting.resolve(grant.lease);
			} else engine.decoderRelease(grant.owner, grant.lease);
		}
	}
	for (const [id, owner] of owners)
		for (const lease of owner.active) {
			if (!owner.notified.has(lease) && engine.decoderShouldYield(id, lease)) {
				owner.notified.add(lease);
				owner.yield(lease);
			}
		}
}
export function openDecoderLeases(onYield: (lease: number) => void = () => {}) {
	const engine = editorEngine(),
		id = engine.decoderOpen();
	const owner: Owner = {
		pending: new Map(),
		active: new Set(),
		notified: new Set(),
		yield: onYield,
	};
	owners.set(id, owner);
	let next = 0,
		closed = false;
	return {
		request(kind: "video" | "audio", slots: 1 | 2 = 1): Promise<number> {
			if (closed) return Promise.reject(new Error("Decoder owner is closed"));
			const request = ++next;
			const result = new Promise<number>((resolve, reject) =>
				owner.pending.set(request, { resolve, reject }),
			);
			const accepted = engine.decoderRequest(id, request, kind === "video" ? 1 : 2, slots);
			if (!accepted.ok) {
				owner.pending.get(request)?.reject(new Error(accepted.error.message));
				owner.pending.delete(request);
			}
			deliver();
			return result;
		},
		release(lease: number): void {
			if (!closed) {
				owner.active.delete(lease);
				owner.notified.delete(lease);
				engine.decoderRelease(id, lease);
				deliver();
			}
		},
		/** Call only after worker disposal acknowledgement or termination. */
		close(): void {
			if (closed) return;
			closed = true;
			for (const waiting of owner.pending.values())
				waiting.reject(new Error("Decoder owner is closed"));
			owners.delete(id);
			engine.decoderClose(id);
			deliver();
		},
	};
}
