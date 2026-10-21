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

/** Replace managed URLs only for the live render. Persisted job input keeps
 * stable IDs; temporary HTTP files disappear after Remotion finishes. */
export async function materializeManagedInputs<T>(
	input: T,
	workspace: string,
	fetchImpl: (input: URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ value: T; cleanup: () => Promise<void> }> {
	const ids = new Set<string>();
	const collect = (value: unknown): void => {
		if (typeof value === "string") {
			const id = managedId(value);
			if (id) ids.add(id);
		} else if (Array.isArray(value)) value.forEach(collect);
		else if (value && typeof value === "object") Object.values(value).forEach(collect);
	};
	collect(input);
	if (ids.size === 0) return { value: input, cleanup: async () => {} };
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
		for (const id of ids) {
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
			// Streamed to disk: these inputs include full videos.
			if (!response.body) throw new Error(`managed render input ${id} has no body`);
			await response.body.pipeTo(Writable.toWeb(createWriteStream(file)), { signal });
			urls.set(id, `${publicBase.replace(/\/$/, "")}/render-inputs/${basename(dir)}/${id}.${ext}`);
		}
		const replace = (value: unknown): unknown => {
			if (typeof value === "string") return urls.get(managedId(value) ?? "") ?? value;
			if (Array.isArray(value)) return value.map(replace);
			if (value && typeof value === "object")
				return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
			return value;
		};
		// SAFETY: replace walks input's own tree and changes only string leaves;
		// object keys, arrays, and non-string values keep their original shape.
		return { value: replace(input) as T, cleanup: () => rm(dir, { recursive: true, force: true }) };
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}
