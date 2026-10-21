import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Aspect } from "../schema";
import { aspectMap } from "../schema";
import { fetchWithRetry } from "./retry";

export type PrepOptions = {
	url: string;
	aspect: Aspect;
	removeBg?: boolean;
	upscale?: boolean;
	cacheDir?: string;
	/** Keep authored storyboard geometry and alpha; composition owns crop/fit. */
	preserveSource?: boolean;
};

export type PrepResult = {
	localPath: string;
	width: number;
	height: number;
	cached: boolean;
};

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function dashboardAssetCandidates(url: string): string[] {
	if (!url.startsWith("/")) return [url];
	const envBase = (process.env.MALEO_API_URL ?? process.env.MALEO_APP_URL)?.replace(/\/$/, "");
	const configuredHost = process.env.MALEO_API_HOST?.trim();
	return unique([
		envBase ? `${envBase}${url}` : "",
		configuredHost ? `http://${configuredHost}:3030${url}` : "",
		configuredHost ? `http://${configuredHost}:8090${url}` : "",
		`http://127.0.0.1:3030${url}`,
		`http://localhost:3030${url}`,
		`http://127.0.0.1:8090${url}`,
		`http://localhost:8090${url}`,
	]);
}

export async function prepareImage(opts: PrepOptions): Promise<PrepResult> {
	const cacheDir = opts.cacheDir ?? path.resolve("public/images");
	await fs.mkdir(cacheDir, { recursive: true });

	const hash = crypto
		.createHash("sha256")
		.update(
			`${opts.url}|${opts.aspect}|${opts.removeBg ?? false}|${opts.upscale ?? false}${opts.preserveSource ? "|source" : ""}`,
		)
		.digest("hex")
		.slice(0, 16);
	const target = aspectMap[opts.aspect];
	const localPath = path.join(cacheDir, `${hash}.${opts.preserveSource ? "png" : "jpg"}`);

	try {
		const stat = await fs.stat(localPath);
		if (stat.size > 0) {
			const { width, height } = await sharp(localPath).metadata();
			return { localPath, width: width!, height: height!, cached: true };
		}
	} catch {}

	const raw = await fetchImage(opts.url);
	let pipeline = sharp(raw, { failOn: "none" }).rotate();

	if (opts.removeBg) {
		pipeline = await applyBgRemoval(pipeline, opts.url);
	}

	const prepared = opts.preserveSource
		? pipeline.png()
		: pipeline
				.resize({
					width: target.width,
					height: target.height,
					fit: "cover",
					position: "attention",
				})
				.jpeg({ quality: 90, mozjpeg: true });
	const { data, info } = await prepared.toBuffer({ resolveWithObject: true });

	await fs.writeFile(localPath, data);
	return { localPath, width: info.width, height: info.height, cached: false };
}

async function fetchImage(url: string): Promise<Buffer> {
	if (url.startsWith("http://") || url.startsWith("https://")) {
		const res = await fetchWithRetry(url, undefined, { label: `image-fetch ${url.slice(0, 60)}` });
		return Buffer.from(await res.arrayBuffer());
	}
	if (url.startsWith("/")) {
		let lastErr: unknown;
		for (const candidate of dashboardAssetCandidates(url)) {
			try {
				const res = await fetchWithRetry(candidate, undefined, {
					label: `image-fetch ${candidate.slice(0, 60)}`,
				});
				return Buffer.from(await res.arrayBuffer());
			} catch (err) {
				lastErr = err;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(`could not fetch dashboard asset ${url}`);
	}
	return fs.readFile(url);
}

async function applyBgRemoval(pipeline: sharp.Sharp, sourceUrl: string): Promise<sharp.Sharp> {
	const apiKey = process.env.REMOVE_BG_API_KEY;
	if (!apiKey) return pipeline;

	const buf = await pipeline.png().toBuffer();
	const form = new FormData();
	form.append("image_file", new Blob([new Uint8Array(buf)], { type: "image/png" }), "in.png");
	form.append("size", "auto");

	const res = await fetch("https://api.remove.bg/v1.0/removebg", {
		method: "POST",
		headers: { "X-Api-Key": apiKey },
		body: form,
	});
	if (!res.ok) {
		console.warn(`remove.bg failed for ${sourceUrl}, keeping original`);
		return pipeline;
	}
	return sharp(Buffer.from(await res.arrayBuffer()));
}

export async function prepareAll(
	urls: string[],
	aspect: Aspect,
	opts?: Omit<PrepOptions, "url" | "aspect">,
): Promise<string[]> {
	const results = await Promise.all(urls.map((url) => prepareImage({ url, aspect, ...opts })));
	return results.map((r) => r.localPath);
}
