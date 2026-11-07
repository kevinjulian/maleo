import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Writable } from "node:stream";

const ID = /^\/api\/media\/([0-9a-f-]{36})$/;

function managedId(value: string): string | null {
	try {
		return ID.exec(new URL(value, "http://local.invalid").pathname)?.[1] ?? null;
	} catch {
		return null;
	}
}

export interface ManagedInputs<T> {
	value: T;
	cleanup: () => Promise<void>;
	/** Puts the stable managed URLs back into a value derived from `value`. */
	restore: <V>(value: V) => V;
}

function mapStrings(value: unknown, map: (text: string) => string): unknown {
	if (typeof value === "string") return map(value);
	if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
		);
	return value;
}

/** Replace managed URLs only for the live render. Persisted job input keeps
 * stable IDs; temporary HTTP files disappear after Remotion finishes. */
export async function materializeManagedInputs<T>(
	input: T,
	workspace: string,
	fetchImpl: (input: URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ManagedInputs<T>> {
	// Each ID with the first form it appears in, so `restore` writes that form back.
	const ids = new Map<string, string>();
	const collect = (value: unknown): void => {
		if (typeof value === "string") {
			const id = managedId(value);
			if (id && !ids.has(id)) ids.set(id, value);
		} else if (Array.isArray(value)) value.forEach(collect);
		else if (value && typeof value === "object") Object.values(value).forEach(collect);
	};
	collect(input);
	if (ids.size === 0) return { value: input, cleanup: async () => {}, restore: (value) => value };
	const api = process.env.MALEO_API_URL?.trim();
	const token = process.env.MALEO_SERVICE_TOKEN?.trim();
	const publicBase = process.env.MALEO_VIDEO_PUBLIC_BASE?.trim();
	if (!api || !token || !publicBase)
		throw new Error(
			"managed render inputs require MALEO_API_URL, MALEO_SERVICE_TOKEN, and MALEO_VIDEO_PUBLIC_BASE",
		);
	const parent = resolve("public/render-inputs");
	await mkdir(parent, { recursive: true });
	const dir = await mkdtemp(join(parent, "job-"));
	try {
		const urls = new Map<string, string>();
		const originals = new Map<string, string>();
		for (const [id, original] of ids) {
			const endpoint = new URL(`/internal/media/${id}`, api);
			endpoint.searchParams.set("workspace", workspace);
			// Bound headers and body transfer so a stalled source cannot occupy the worker indefinitely.
			const signal = AbortSignal.timeout(120_000);
			const response = await fetchImpl(endpoint, {
				headers: { authorization: `Bearer ${token}` },
				signal,
			});
			if (!response.ok)
				throw new Error(`managed render input ${id} unavailable (${response.status})`);
			const type = response.headers.get("content-type") ?? "application/octet-stream";
			const ext =
				type === "image/jpeg"
					? "jpg"
					: type === "video/mp4"
						? "mp4"
						: type === "audio/mpeg"
							? "mp3"
							: (type.split("/")[1]?.split(";")[0] ?? "bin");
			const file = join(dir, `${id}.${ext}`);
			// Streamed to disk: these inputs include full videos. Hashed on the way, so
			// bytes that differ from the registry never reach a renderer (p2-export 3.4).
			if (!response.body) throw new Error(`managed render input ${id} has no body`);
			const expected = response.headers.get("x-maleo-sha256")?.trim().toLowerCase();
			const hash = createHash("sha256");
			const hashing = new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					hash.update(chunk);
					controller.enqueue(chunk);
				},
			});
			await response.body
				.pipeThrough(hashing)
				.pipeTo(Writable.toWeb(createWriteStream(file)), { signal });
			const actual = hash.digest("hex");
			if (expected && actual !== expected)
				throw new Error(
					`managed render input ${id} failed its SHA-256 check (expected ${expected}, got ${actual})`,
				);
			const local = `${publicBase.replace(/\/$/, "")}/render-inputs/${basename(dir)}/${id}.${ext}`;
			urls.set(id, local);
			originals.set(local, original);
		}
		// SAFETY: mapStrings walks the value's own tree and changes only string
		// leaves; object keys, arrays, and non-string values keep their shape.
		return {
			value: mapStrings(input, (text) => urls.get(managedId(text) ?? "") ?? text) as T,
			cleanup: () => rm(dir, { recursive: true, force: true }),
			restore: <V>(value: V) => mapStrings(value, (text) => originals.get(text) ?? text) as V,
		};
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}
