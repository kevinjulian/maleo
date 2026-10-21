import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

/** Storage adapters lack cancellation; late writes are discarded, never made ready. */
export async function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([pending, cancelled]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

export async function downloadSource(
	response: Response,
	path: string,
	limit: number,
	fingerprint: string,
	signal: AbortSignal,
): Promise<number> {
	if (!response.body) throw new Error("Import source has no bytes");
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && length > limit)
		throw new Error("Import source exceeds byte limit");
	const reader = response.body.getReader();
	const file = await open(path, "wx", 0o600);
	const hash = createHash("sha256");
	let size = 0;
	try {
		while (true) {
			const { value, done } = await bounded(reader.read(), signal);
			if (done) break;
			size += value.byteLength;
			if (size > limit) throw new Error("Import source exceeds byte limit");
			hash.update(value);
			await file.writeFile(value);
		}
		if (!size || hash.digest("hex") !== fingerprint)
			throw new Error("Import source fingerprint changed");
		return size;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
		await file.close();
	}
}
