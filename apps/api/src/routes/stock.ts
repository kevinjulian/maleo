/* Stock media proxy — images/videos via Pexels, music via Maleo's curated
 * library, SFX via Freesound. Missing setup returns configured:false so the UI
 * can show a clear hint instead of failing.
 *
 * The provider calls themselves live in @maleo/stock; this route only maps the
 * canonical StockAsset/StockAudio shapes onto the wire shape the picker expects. */
import { refreshProviderConfig } from "../lib/provider-config-source.ts";
import { Hono } from "hono";
import {
	isPexelsConfigured,
	isFreesoundConfigured,
	isMusicLibraryPublished,
	searchFreesoundSfx,
	searchMusicLibrary,
	searchPexelsImages,
	searchPexelsVideos,
	type StockAsset,
} from "@maleo/stock";
import { keysOf, oneOf, STOCK_AUDIO_HOSTS } from "@maleo/shared";

/** Forward only a Range header, so seeking still works through the passthrough. */
function rangeHeaders(range: string | undefined): HeadersInit {
	return range ? { range } : {};
}

export interface StockItem {
	id: string;
	thumb: string;
	url: string;
	kind: "image" | "video" | "audio";
	author?: string;
	dur?: number;
	title?: string;
	bpm?: number;
	tags?: string[];
	provider?: string;
	pageUrl?: string;
	authorUrl?: string;
	license?: string;
	licenseUrl?: string;
}

interface StockResponse {
	configured: boolean;
	items: StockItem[];
	note?: string;
	error?: string;
}

export const toItem = (asset: StockAsset): StockItem => ({
	id: asset.id,
	thumb: asset.thumbUrl ?? "",
	url: asset.url,
	kind: asset.kind,
	author: asset.author,
	dur: asset.durationSec,
	title: asset.title,
	tags: asset.tags,
	provider: asset.provider,
	pageUrl: asset.pageUrl,
	authorUrl: asset.authorUrl,
	license: asset.license,
	licenseUrl: asset.licenseUrl,
});

async function searchMusic(q: string): Promise<StockResponse> {
	// An unpublished library is a different condition from "no matches", and the
	// picker should say so rather than showing an empty list the operator cannot
	// explain.
	if (!(await isMusicLibraryPublished())) {
		return {
			configured: false,
			items: [],
			note: "No music library published yet. Compile a manifest with compile:manifest, then publish:music.",
		};
	}
	const beds = await searchMusicLibrary(q, 24);
	return {
		configured: true,
		items: beds.map((bed, i): StockItem => ({
			id: `lib-${i}-${bed.url.slice(-12)}`,
			thumb: "",
			url: bed.url,
			kind: "audio",
			title: bed.title,
			author: bed.author,
			dur: bed.durationSec,
			provider: "Local",
			pageUrl: bed.source,
			license: bed.license,
		})),
	};
}

async function searchSfx(q: string): Promise<StockResponse> {
	if (!isFreesoundConfigured())
		return {
			configured: false,
			items: [],
			note: "Configure Freesound under Settings → Capabilities → Sound effects.",
		};
	try {
		const sounds = await searchFreesoundSfx(q, 24);
		return {
			configured: true,
			items: sounds.map((s, i): StockItem => ({
				id: `fs-${i}-${s.url.slice(-12)}`,
				thumb: "",
				url: s.url,
				kind: "audio",
				title: s.title,
				author: s.author,
				authorUrl: s.authorUrl,
				pageUrl: s.pageUrl,
				license: s.license,
				licenseUrl: s.licenseUrl,
				dur: s.durationSec,
				provider: "Freesound",
			})),
		};
	} catch (err) {
		return { configured: true, items: [], error: err instanceof Error ? err.message : String(err) };
	}
}

async function searchVisual(type: string, q: string): Promise<StockResponse> {
	if (!isPexelsConfigured())
		return {
			configured: false,
			items: [],
			note: "Configure Pexels under Settings → Capabilities → Stock visuals.",
		};
	const assets = type === "videos" ? await searchPexelsVideos(q) : await searchPexelsImages(q);
	return { configured: true, items: assets.map(toItem) };
}

export function stockRoutes(): Hono {
	const app = new Hono();
	// Readiness and credentials are read synchronously from the config snapshot;
	// every request here is an async boundary, so reload it first.
	app.use("*", async (_c, next) => {
		await refreshProviderConfig();
		await next();
	});

	app.get("/search", async (c) => {
		const type = c.req.query("type") ?? "images";
		const q =
			(c.req.query("q") ?? "").trim() ||
			(type === "music" ? "ambient" : type === "sfx" ? "whoosh" : "cinematic");

		if (type === "music") return c.json(await searchMusic(q));
		if (type === "sfx") return c.json(await searchSfx(q));
		return c.json(await searchVisual(type, q));
	});

	/* Same-origin passthrough for stock audio, which fixes two things the hosts
	 * do not do for us.
	 *
	 * Neither host sends an `Access-Control-Allow-Origin`, which playback does
	 * not care about and `AudioContext.decodeAudioData` does: a stock clip fell
	 * back to its label while local `/uploads` audio drew a waveform, and the
	 * difference was entirely the origin. And the sound-effect CDN sends no
	 * `cache-control` at all, so a project with thirty effect clips re-downloads
	 * the same file every session.
	 *
	 * The HOST is chosen by a key from a fixed map, never by the caller, and the
	 * path is appended to it — so this cannot be turned into a request forwarder
	 * for somewhere else. A path that tries to escape is refused rather than
	 * normalised, because normalising a suspicious path is how that guarantee
	 * gets lost later. */
	app.get("/audio/:host/*", async (c) => {
		const key = c.req.param("host");
		/* `oneOf` against the host table's own keys rather than `Object.hasOwn` plus
		   a cast. It returns the matched key, so the lookup below needs no
		   assertion — and it is immune to the inherited-key problem the `hasOwn`
		   was guarding against, because a prototype name is not in the list. */
		const hostKey = oneOf(key, keysOf(STOCK_AUDIO_HOSTS));
		if (!hostKey) return c.text("unknown host", 404);
		const host = STOCK_AUDIO_HOSTS[hostKey];
		const marker = `/audio/${key}/`;
		const at = c.req.path.indexOf(marker);
		const path = at < 0 ? "" : c.req.path.slice(at + marker.length);
		if (!path || path.includes("..") || path.includes("//")) return c.text("bad path", 400);
		const res = await fetch(`${host}/${path}`, { headers: rangeHeaders(c.req.header("range")) });
		if (!res.ok && res.status !== 206) return c.text("not found", 404);
		const headers = new Headers();
		for (const header of [
			"content-type",
			"content-length",
			"content-range",
			"accept-ranges",
			"etag",
		]) {
			const value = res.headers.get(header);
			if (value) headers.set(header, value);
		}
		// Content addressed by name and never rewritten in place, so the browser
		// should not re-fetch it on every timeline render or every session.
		headers.set("cache-control", "public, max-age=86400");
		return new Response(res.body, { status: res.status, headers });
	});

	return app;
}
