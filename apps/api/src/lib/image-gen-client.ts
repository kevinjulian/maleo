import { createMediaClient, type MediaClient } from "@maleo/media/api";
import { z } from "zod";

/* The media worker's `/health`. `ok` is the only field this client needs; the
 * rest are diagnostics the settings panel shows when present. */
const healthSchema = z
	.object({
		ok: z.boolean(),
		browser: z.object({ alive: z.boolean() }).passthrough().optional(),
		queue_depth: z.number().optional(),
		uptime_s: z.number().optional(),
	})
	.passthrough();

const imageUrl = (): string => process.env.MALEO_GEN_WORKER_URL?.trim() ?? "";
const imageToken = (): string =>
	process.env.MALEO_GEN_WORKER_TOKEN || process.env.MALEO_SERVICE_TOKEN || "";
let mediaClientOverride: MediaClient | null | undefined;

export function mediaWorkerConfigured(): boolean {
	return Boolean(imageUrl());
}

export function getMediaClient(): MediaClient | null {
	if (mediaClientOverride !== undefined) return mediaClientOverride;
	const base = process.env.MALEO_GEN_WORKER_URL?.trim();
	if (!base) return null;
	return createMediaClient({ baseUrl: base, token: imageToken() || undefined });
}

export function setMediaClientForTests(client: MediaClient | null | undefined): void {
	mediaClientOverride = client;
}

export interface ImageGenHealth {
	configured: boolean;
	ok: boolean;
	browser_alive?: boolean;
	queue_depth?: number;
	uptime_s?: number;
	error?: string;
}

export async function getImageGenHealth(): Promise<ImageGenHealth> {
	const URL = imageUrl();
	const TOKEN = imageToken();
	if (!URL) return { configured: false, ok: false };
	try {
		const res = await fetch(`${URL}/health`, {
			headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) {
			return { configured: true, ok: false, error: `HTTP ${res.status}` };
		}
		/* A health body this client cannot read is not a healthy service — the
		 * same answer the `!res.ok` branch above already gives, and the same one
		 * every other health check in the repo settled on. */
		const parsed = healthSchema.safeParse(await res.json().catch(() => undefined));
		if (!parsed.success)
			return { configured: true, ok: false, error: "unreadable health response" };
		const data = parsed.data;
		return {
			configured: true,
			ok: data.ok,
			browser_alive: data.browser?.alive,
			queue_depth: data.queue_depth,
			uptime_s: data.uptime_s,
		};
	} catch (err) {
		return {
			configured: true,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function getImageGenBaseUrl(): string | null {
	return imageUrl() || null;
}

export function getImagePublicBaseUrl(base: string): string {
	if (process.env.MALEO_GEN_WORKER_PUBLIC_URL?.trim()) {
		return process.env.MALEO_GEN_WORKER_PUBLIC_URL.trim();
	}
	return base;
}
