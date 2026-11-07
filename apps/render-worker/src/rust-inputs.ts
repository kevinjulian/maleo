/* Local files for every media URL the Rust render host needs (OpenSpec p2-export E4).
 *
 * The host makes no network request, so the worker maps each URL the host lists
 * (`maleo-render media`) to a file before the render:
 *
 * - `MALEO_VIDEO_PUBLIC_BASE/...` (managed inputs, prepared TTS and images) is a
 *   file under this process's `public/` directory; a path that leaves it is refused.
 * - `http(s)://` (stock and other external media) is downloaded, bounded in time
 *   and size, into the job's scratch directory.
 * - `data:` is decoded into the scratch directory.
 *
 * Anything else is refused with the URL named, so the job fails before rendering. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Writable } from "node:stream";

/** Largest external download, in bytes. */
const MAX_EXTERNAL_BYTES = 2 * 1024 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;

export interface RustInputs {
	media: Record<string, string>;
	cleanup: () => Promise<void>;
}

function publicFile(url: string, publicBase: string, publicDir: string): string | null {
	const base = publicBase.replace(/\/$/, "");
	if (!url.startsWith(`${base}/`)) return null;
	// URL parsing resolves `..`: a normalized path outside the base left the directory.
	const basePath = new URL(base).pathname.replace(/\/$/, "");
	const pathname = new URL(url).pathname;
	if (!pathname.startsWith(`${basePath}/`))
		throw new Error(`render input ${url} leaves the public directory`);
	const rest = decodeURIComponent(pathname.slice(basePath.length + 1));
	const file = resolve(publicDir, rest);
	const inside = relative(publicDir, file);
	if (inside.startsWith("..") || inside.includes(`..${sep}`) || resolve(file) === publicDir)
		throw new Error(`render input ${url} leaves the public directory`);
	if (!existsSync(file) || !statSync(file).isFile())
		throw new Error(`render input ${url} is not a local file`);
	return file;
}

function decodeDataUrl(url: string): Uint8Array {
	const match = /^data:[^,;]*(;base64)?,(.*)$/s.exec(url);
	if (!match) throw new Error("render input data URL is malformed");
	const body = match[2] ?? "";
	return match[1]
		? Uint8Array.from(Buffer.from(body, "base64"))
		: new TextEncoder().encode(decodeURIComponent(body));
}

async function download(
	url: string,
	file: string,
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const response = await fetchImpl(url, { signal });
	if (!response.ok || !response.body)
		throw new Error(`render input ${url} unavailable (${response.status})`);
	const declared = Number(response.headers.get("content-length") ?? "0");
	if (declared > MAX_EXTERNAL_BYTES) throw new Error(`render input ${url} is too large`);
	let total = 0;
	const limit = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			total += chunk.byteLength;
			if (total > MAX_EXTERNAL_BYTES)
				controller.error(new Error(`render input ${url} is too large`));
			else controller.enqueue(chunk);
		},
	});
	await response.body
		.pipeThrough(limit)
		.pipeTo(Writable.toWeb(createWriteStream(file)), { signal });
}

export async function resolveRustInputs(
	urls: readonly string[],
	options: {
		publicBase: string;
		publicDir?: string;
		fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
	},
): Promise<RustInputs> {
	const publicDir = resolve(options.publicDir ?? "public");
	const parent = join(publicDir, "rust-inputs");
	await mkdir(parent, { recursive: true });
	const dir = await mkdtemp(join(parent, "job-"));
	const cleanup = () => rm(dir, { recursive: true, force: true });
	try {
		const media: Record<string, string> = {};
		let index = 0;
		for (const url of urls) {
			const local = publicFile(url, options.publicBase, publicDir);
			if (local) {
				media[url] = local;
			} else if (url.startsWith("data:")) {
				const file = join(dir, `inline-${index++}`);
				await writeFile(file, decodeDataUrl(url));
				media[url] = file;
			} else if (/^https?:\/\//i.test(url)) {
				const extension = /\.([a-z0-9]{1,5})(?:$|\?)/i.exec(new URL(url).pathname)?.[1] ?? "bin";
				const file = join(dir, `external-${index++}.${extension}`);
				await download(url, file, options.fetchImpl ?? fetch);
				media[url] = file;
			} else {
				throw new Error(`render input ${url} has no local file`);
			}
		}
		return { media, cleanup };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
