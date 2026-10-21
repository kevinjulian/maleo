// Per-scene image resolution. Turns a scene's `visual` description into an image
// file. Prefers the maleo-image service (Gemini) when MALEO_IMAGE_URL is set;
// otherwise renders a local placeholder so the pipeline (and samples) work with
// no external services. Results are cached by description hash, so reusing the
// same visual across scenes is instant.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Aspect } from "../schema";
import { fetchWithRetry } from "./retry";
import { z } from "zod";
import { getMedia } from "@maleo/storage";

/* The image service's submit and poll bodies. Third-party-shaped from this
 * package's point of view: `@maleo/video` reaches the image service over HTTP
 * and shares no module with it. */
const imageSubmitSchema = z.object({ job_id: z.string().optional() }).passthrough();

const imageJobSchema = z
	.object({
		status: z.string(),
		image_url: z.string().optional(),
		image_path: z.string().optional(),
		storage_key: z.string().nullish(),
	})
	.passthrough();

const DIMS = {
	horizontal: { w: 1920, h: 1080 },
	square: { w: 1080, h: 1080 },
	vertical: { w: 1080, h: 1920 },
} satisfies Record<Aspect, { w: number; h: number }>;

function hash(s: string): string {
	return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function escapeXml(s: string): string {
	return s.replace(
		/[<>&'"]/g,
		(c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
	);
}

// Deterministic gradient + label placeholder. Color derives from the text hash
// so each distinct visual gets a stable, distinct look (and reuse stays stable).
async function renderPlaceholder(
	visual: string,
	label: string,
	aspect: Aspect,
	out: string,
): Promise<void> {
	const { w, h } = DIMS[aspect];
	const hue = parseInt(hash(visual).slice(0, 4), 16) % 360;
	const c1 = `hsl(${hue} 60% 22%)`;
	const c2 = `hsl(${(hue + 40) % 360} 55% 10%)`;
	const title = escapeXml(label || "scene");
	const sub = escapeXml(visual.slice(0, 90));
	const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="46%" fill="#ffffff" font-family="sans-serif" font-size="${Math.round(h * 0.07)}" font-weight="700" text-anchor="middle">${title}</text>
    <text x="50%" y="56%" fill="#ffffffcc" font-family="sans-serif" font-size="${Math.round(h * 0.03)}" text-anchor="middle">${sub}</text>
  </svg>`;
	await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(out);
}

// Map the video aspect to the image service's aspect enum so the image is
// GENERATED at the right ratio (single-canvas mode clicks the in-page aspect
// button) instead of generating 1:1 and getting cropped.
const IMG_ASPECT = {
	horizontal: "16:9",
	square: "1:1",
	vertical: "9:16",
} satisfies Record<Aspect, "1:1" | "16:9" | "9:16">;

// Try the image service: POST /generate -> poll until done -> download result.
async function tryService(prompt: string, out: string, aspect: Aspect): Promise<boolean> {
	const IMG_URL = process.env.MALEO_IMAGE_URL?.replace(/\/$/, "") ?? "";
	const IMG_TOKEN = process.env.MALEO_IMAGE_TOKEN ?? "";
	if (!IMG_URL) return false;
	try {
		const auth: Record<string, string> = IMG_TOKEN ? { authorization: `Bearer ${IMG_TOKEN}` } : {};
		const res = await fetchWithRetry(
			`${IMG_URL}/generate`,
			{
				method: "POST",
				headers: { "content-type": "application/json", ...auth },
				body: JSON.stringify({ prompt, aspect: IMG_ASPECT[aspect] }),
			},
			{ label: "image-service generate" },
		);
		/* An unreadable submit body falls into the same `return false` a missing
		 * job id already took: with no id there is nothing to poll. */
		const submitted = imageSubmitSchema.safeParse(await res.json().catch(() => undefined));
		const job_id = submitted.success ? submitted.data.job_id : undefined;
		if (!job_id) return false;
		for (let i = 0; i < 60; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			// Status lives at /jobs/:id (the POST is /generate).
			const poll = await fetch(`${IMG_URL}/jobs/${job_id}`, { headers: auth });
			if (!poll.ok) continue;
			/* An unreadable poll body means "not done yet" and the loop tries again,
			 * which is what a non-2xx already did on the line above. The 60-attempt
			 * bound is what stops it being forever. */
			const polled = imageJobSchema.safeParse(await poll.json().catch(() => undefined));
			if (!polled.success) continue;
			const job = polled.data;
			if (job.status === "done" && job.storage_key) {
				await fs.writeFile(out, Buffer.from(await (await getMedia(job.storage_key)).arrayBuffer()));
				return true;
			}
			if (job.status === "done" && (job.image_url || job.image_path)) {
				const rel = job.image_url ?? "";
				const src = /^https?:/.test(rel) ? rel : `${IMG_URL}${rel || job.image_path}`;
				const img = await fetch(src, { headers: auth });
				if (!img.ok) return false;
				await fs.writeFile(out, Buffer.from(await img.arrayBuffer()));
				return true;
			}
			if (job.status === "error" || job.status === "failed") return false;
		}
		return false;
	} catch {
		return false;
	}
}

export interface ResolveOptions {
	aspect?: Aspect;
	cacheDir?: string;
	/** Force placeholder even if the service is configured (used by samples). */
	placeholderOnly?: boolean;
	/**
	 * Re-attempt the image service for entries cached as a placeholder (a prior
	 * failed gen). Lets a "Retry images" re-render actually repair degraded art
	 * instead of reusing the cached stand-in. Real cached art is never re-fetched.
	 */
	retryPlaceholder?: boolean;
}

// Where a resolved image came from. "placeholder" means the image service was
// unreachable / failed and a local gradient stand-in was used — surfaced so the
// pipeline can warn the user instead of silently shipping stand-in art.
export type ImageSource = "cache" | "service" | "placeholder";

export interface ResolvedImage {
	path: string;
	source: ImageSource;
}

// Resolve one visual to an image path. Cached by (visual|aspect) so reuse is free.
// Returns the source so callers can distinguish real art from placeholder
// fallbacks (cache hits are prior generations and not re-attributed).
export async function resolveSceneImage(
	visual: string,
	label: string,
	opts?: ResolveOptions,
): Promise<ResolvedImage> {
	const aspect = opts?.aspect ?? "horizontal";
	const cacheDir = opts?.cacheDir ?? path.resolve("public/scene-images");
	await fs.mkdir(cacheDir, { recursive: true });
	const out = path.join(cacheDir, `${hash(`${visual}|${aspect}`)}.jpg`);
	// Sidecar marker: written next to a cached jpg when it's a placeholder, so a
	// cache hit stays attributed as degraded instead of masquerading as real art
	// (a second render must not report clean when reusing a placeholder).
	const marker = `${out}.placeholder`;
	try {
		const stat = await fs.stat(out);
		if (stat.size > 0) {
			const wasPlaceholder = await fs
				.stat(marker)
				.then(() => true)
				.catch(() => false);
			// A cached placeholder is degraded art. On an explicit retry, try the
			// service again (it may be back up); only fall through to reusing the
			// placeholder if it still fails. Real cached art short-circuits here.
			if (
				wasPlaceholder &&
				opts?.retryPlaceholder &&
				!opts?.placeholderOnly &&
				(await tryService(visual, out, aspect))
			) {
				await fs.rm(marker, { force: true }).catch(() => {});
				return { path: out, source: "service" };
			}
			return { path: out, source: wasPlaceholder ? "placeholder" : "cache" };
		}
	} catch {}

	if (!opts?.placeholderOnly && (await tryService(visual, out, aspect))) {
		// Real art now exists — clear any stale placeholder marker from a prior run.
		await fs.rm(marker, { force: true }).catch(() => {});
		return { path: out, source: "service" };
	}
	await renderPlaceholder(visual, label, aspect, out);
	await fs.writeFile(marker, "1").catch(() => {});
	return { path: out, source: "placeholder" };
}
