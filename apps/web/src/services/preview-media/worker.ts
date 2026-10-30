import { installCodecLifetime } from "./codec-lifetime.ts";
import { z } from "zod";
import { createSourceLoader } from "./source-loader.ts";
import { createSourceStorage } from "./source-storage.ts";
import { validateSource, type DecoderProbe } from "./source-validation.ts";

const identity = z.object({ id: z.string().min(1), revision: z.string().min(1) });
const request = z.discriminatedUnion("type", [
	z.object({ type: z.literal("yield-decoder"), lease: z.number().int().positive() }),
	z.object({
		type: z.literal("decoder-result"),
		requestId: z.number().int().positive(),
		lease: z.number().int().positive().nullable(),
	}),
	z.object({
		type: z.literal("memory-result"),
		reservation: z.number().int().nonnegative(),
		accepted: z.boolean(),
	}),
	z.object({
		type: z.literal("load"),
		source: identity
			.extend({
				requestId: z.number().int().positive(),
				kinds: z.array(z.enum(["image", "video", "audio"])).nonempty(),
				file: z.instanceof(File).optional(),
				target: z
					.object({
						url: z.string().min(1),
						credentials: z.enum(["include", "omit", "same-origin"]),
					})
					.optional(),
			})
			.refine(
				(source) => Boolean(source.file) !== Boolean(source.target),
				"Provide one complete File or fetch target",
			),
	}),
	z.object({ type: z.literal("cancel"), source: identity }),
	z.object({ type: z.literal("dispose") }),
]);

interface WorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(message: unknown): void;
}
// SAFETY: this module is built only as a dedicated worker entry.
const scope = globalThis as WorkerScope;
const codecs = installCodecLifetime();
let nextReservation = 0;
const reservations = new Map<number, (accepted: boolean) => void>();
const storage = createSourceStorage(crypto.randomUUID(), navigator.storage, {
	reserve: (bytes) =>
		new Promise((resolve) => {
			const reservation = nextReservation++;
			reservations.set(reservation, resolve);
			scope.postMessage({ type: "reserve-memory", reservation, bytes });
		}),
	release: (bytes) => scope.postMessage({ type: "release-memory", bytes }),
});
let disposed = false;
let nextProbe = 0;
const probes = new Map<number, (lease: number | null) => void>();
const yields = new Map<number, () => void>();
const withDecoder: DecoderProbe = async (kind, probe, slots = 1) => {
	if (disposed) throw new Error("Media validation cancelled");
	const requestId = ++nextProbe;
	const lease = await new Promise<number | null>((resolve) => {
		probes.set(requestId, resolve);
		scope.postMessage({ type: "decoder-request", requestId, kind, slots });
	});
	if (lease === null) throw new Error("Media decoder request cancelled");
	let yielded = false;
	const yielding = new Promise<void>((resolve) =>
		yields.set(lease, () => {
			yielded = true;
			resolve();
		}),
	);
	const lifetime = kind === "video" ? codecs.video : codecs.audio;
	lifetime.allow(slots);
	try {
		if (disposed) throw new Error("Media validation cancelled");
		return await probe({ id: lease, yielded: yielding, isYielded: () => yielded });
	} finally {
		lifetime.close();
		yields.delete(lease);
		scope.postMessage({ type: "decoder-release", lease });
	}
};
let validation = Promise.resolve();
const current = new Map<string, number>();
const leases = new Map<string, ReturnType<(typeof storage)["lease"]>>();
const keyOf = (source: { id: string; revision: string }) =>
	JSON.stringify([source.id, source.revision]);
const loader = createSourceLoader({
	createSink: () => storage.createSink(),
	progress: (source, progress) => {
		const requestId = current.get(keyOf(source));
		if (requestId === undefined) return;
		scope.postMessage({
			type: "progress",
			requestId,
			id: source.id,
			revision: source.revision,
			...progress,
		});
	},
});

scope.onmessage = (event) => {
	const parsed = request.safeParse(event.data);
	if (!parsed.success) {
		scope.postMessage({ type: "protocol-error", message: "Invalid preview media worker request" });
		return;
	}
	const message = parsed.data;
	if (message.type === "yield-decoder") {
		yields.get(message.lease)?.();
		return;
	}
	if (message.type === "decoder-result") {
		probes.get(message.requestId)?.(message.lease);
		probes.delete(message.requestId);
		return;
	}
	if (message.type === "memory-result") {
		reservations.get(message.reservation)?.(message.accepted);
		reservations.delete(message.reservation);
		return;
	}
	if (message.type === "dispose") {
		disposed = true;
		for (const yieldLease of yields.values()) yieldLease();
		current.clear();
		leases.clear();
		void loader
			.dispose()
			.then(() => validation)
			.then(() => storage.dispose())
			.then(() => scope.postMessage({ type: "disposed" }))
			.catch((error: unknown) =>
				scope.postMessage({
					type: "protocol-error",
					message: `Preview media cleanup failed (${error instanceof Error ? error.name : "unknown"})`,
				}),
			);
		return;
	}
	if (message.type === "cancel") {
		current.delete(keyOf(message.source));
		void leases.get(keyOf(message.source))?.release();
		leases.delete(keyOf(message.source));
		void loader
			.cancel(message.source)
			.catch(() =>
				scope.postMessage({ type: "protocol-error", message: "Preview media cleanup failed" }),
			);
		return;
	}
	const { source } = message;
	if (disposed) return;
	current.set(keyOf(source), source.requestId);
	let bytesComplete = false;
	const key = keyOf(source);
	if (source.file && !leases.has(key)) leases.set(key, storage.lease(source.file));
	const file = leases.get(key)?.read();
	const bytes = file
		? Promise.resolve(file)
		: source.target
			? loader.load({ ...source, target: source.target })
			: Promise.reject(new Error("Pending source is unavailable"));
	void bytes
		.then(async (file) => {
			bytesComplete = true;
			const svg =
				file.type.split(";")[0]?.trim() === "image/svg+xml" &&
				source.kinds.every((kind) => kind === "image");
			const probe = validation.then(async () => {
				if (disposed || current.get(keyOf(source)) !== source.requestId)
					throw new Error("Media validation cancelled");
				scope.postMessage({
					type: "validating",
					requestId: source.requestId,
					id: source.id,
					revision: source.revision,
				});
				// SVG bytes need the main client's DOM probe, not a worker completion claim.
				if (svg) return null;
				return validateSource(file, source.kinds, withDecoder);
			});
			validation = probe.then(
				() => {},
				() => {},
			);
			const result = await probe;
			if (disposed || current.get(keyOf(source)) !== source.requestId) return;
			scope.postMessage({
				type: svg ? "svg-bytes" : "complete",
				requestId: source.requestId,
				id: source.id,
				revision: source.revision,
				file,
				...(svg ? {} : { probe: result }),
			});
		})
		.catch(async (error: unknown) => {
			if (disposed || current.get(keyOf(source)) !== source.requestId) return;
			current.delete(keyOf(source));
			scope.postMessage({
				type: "failed",
				bytesComplete,
				requestId: source.requestId,
				id: source.id,
				revision: source.revision,
				message:
					error instanceof DOMException && error.name === "QuotaExceededError"
						? "Browser storage quota exceeded"
						: error instanceof Error &&
							  (!source.target || !error.message.includes(source.target.url))
							? error.message
							: "Preview media download failed",
			});
		});
};
