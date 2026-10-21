// Channel capability manifest. Each channel (= plugin) declares what
// content types + aspects it supports. Keeps decision logic in core
// (decideContent) free of platform-specific knowledge.
//
// Source-of-truth in maleo-core is each plugin's manifest.supports
// (see <core>/plugins/<id>/index.ts). This module merges those manifests
// over the baked-in defaults below at startup, reading the plugins dir
// resolved by core. Standalone dashboard still works via defaults.
//
// Types live in @maleo/shared so core + dashboard share the canonical
// definitions. Re-exported here so existing imports keep compiling.

import { z } from "zod";
import {
	ASPECTS,
	CHANNEL_IDS,
	fieldOf,
	MEDIA_TYPES,
	oneOf,
	type ChannelId,
	type ChannelManifest,
	type MediaType,
} from "@maleo/shared";
export type { Aspect, ChannelId, ChannelManifest } from "@maleo/shared";
// Local alias kept for callers that import ContentType from this module.
export type ContentType = MediaType;

const MANIFEST: Record<ChannelId, ChannelManifest> = {
	threads: {
		id: "threads",
		label: "Threads",
		content_types: ["text", "image"],
		max_text_chars: 500,
		max_image_count: 1,
		max_video_duration_sec: 0,
		image_aspect_ratios: ["1:1", "16:9", "4:5"],
		video_aspect_ratios: [],
	},
	instagram: {
		id: "instagram",
		label: "Instagram",
		content_types: ["image", "video"], // IG feed requires media
		max_text_chars: 2200,
		max_image_count: 10,
		max_video_duration_sec: 90,
		image_aspect_ratios: ["1:1", "4:5", "9:16"],
		video_aspect_ratios: ["9:16", "1:1"],
		requires_image: true,
	},
	tiktok: {
		id: "tiktok",
		label: "TikTok",
		content_types: ["video"],
		max_text_chars: 2200,
		max_image_count: 0,
		max_video_duration_sec: 180,
		image_aspect_ratios: [],
		video_aspect_ratios: ["9:16"],
		requires_video: true,
	},
	reels: {
		id: "reels",
		label: "Instagram Reels",
		content_types: ["video"],
		max_text_chars: 2200,
		max_image_count: 0,
		max_video_duration_sec: 90,
		image_aspect_ratios: [],
		video_aspect_ratios: ["9:16"],
		requires_video: true,
	},
	shorts: {
		id: "shorts",
		label: "YouTube Shorts",
		content_types: ["video"],
		max_text_chars: 100,
		max_image_count: 0,
		max_video_duration_sec: 60,
		image_aspect_ratios: [],
		video_aspect_ratios: ["9:16"],
		requires_video: true,
	},
	"yt-long": {
		id: "yt-long",
		label: "YouTube",
		content_types: ["video"],
		max_text_chars: 5000,
		max_image_count: 0,
		max_video_duration_sec: 3600,
		image_aspect_ratios: [],
		video_aspect_ratios: ["16:9"],
		requires_video: true,
	},
};

export function getChannelManifest(id: string): ChannelManifest | null {
	const channelId = oneOf(id, CHANNEL_IDS);
	return channelId ? (MANIFEST[channelId] ?? null) : null;
}

export function listChannelManifests(): ChannelManifest[] {
	return Object.values(MANIFEST);
}

export function channelSupports(id: string, type: ContentType): boolean {
	const m = getChannelManifest(id);
	return m ? m.content_types.includes(type) : false;
}

// --- Optional plugin discovery ------------------------------------------
//
/* What a platform plugin may declare about itself. A plugin is not written by
 * this system, so its manifest is parsed rather than trusted. */
const pluginSupportsSchema = z
	.object({
		channel_id: z.string(),
		label: z.string(),
		content_types: z.array(z.enum(MEDIA_TYPES)),
		max_text_chars: z.number(),
		max_image_count: z.number(),
		max_video_duration_sec: z.number(),
		image_aspect_ratios: z.array(z.enum(ASPECTS)),
		video_aspect_ratios: z.array(z.enum(ASPECTS)),
		requires_image: z.boolean(),
		requires_video: z.boolean(),
	})
	.partial();

// Reads <plugins>/<plugin>/plugin.yaml to extract each plugin's
// manifest.supports block. Plugins resolve from API's workspace paths. Falls back silently when
// the dir doesn't exist or a manifest fails to load.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolvePluginsDir } from "./workspace/paths.ts";

async function tryLoadPluginManifests(): Promise<void> {
	const dir = resolvePluginsDir();
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		const sub = join(dir, name);
		try {
			if (!statSync(sub).isDirectory()) continue;
			const yamlPath = join(sub, "plugin.yaml");
			if (!existsSync(yamlPath)) continue;
			const raw: unknown = parseYaml(readFileSync(yamlPath, "utf8"));
			if (fieldOf(raw, "type") !== "platform") continue;
			let declared = fieldOf(raw, "supports");
			try {
				const indexPath = join(sub, "index.ts");
				if (existsSync(indexPath)) {
					const mod: unknown = await import(indexPath);
					const fromModule = fieldOf(fieldOf(fieldOf(mod, "default"), "manifest"), "supports");
					if (fromModule) declared = fromModule;
				}
			} catch {
				/* keep yaml-only supports */
			}
			const parsed = pluginSupportsSchema.safeParse(declared);
			if (!parsed.success) {
				if (declared !== undefined)
					console.warn(`[channel-caps] plugin ${name} declares unreadable supports; skipped`);
				continue;
			}
			const supports = parsed.data;
			// A plugin manifest is not written by this system: `channel_id` is
			// whatever the plugin author typed. Asserting it into `ChannelId` put an
			// unknown channel into the manifest map under a key nothing could look
			// up, which read as a plugin that loaded and did nothing.
			const channelId = oneOf(supports.channel_id, CHANNEL_IDS);
			if (!channelId) continue;
			MANIFEST[channelId] = {
				id: channelId,
				label: supports.label ?? channelId,
				content_types: supports.content_types ?? ["text"],
				max_text_chars: supports.max_text_chars ?? 0,
				max_image_count: supports.max_image_count ?? 0,
				max_video_duration_sec: supports.max_video_duration_sec ?? 0,
				image_aspect_ratios: supports.image_aspect_ratios ?? [],
				video_aspect_ratios: supports.video_aspect_ratios ?? [],
				requires_image: supports.requires_image,
				requires_video: supports.requires_video,
			};
		} catch (e) {
			console.warn(
				`[channel-caps] failed to load plugin ${name}: ${e instanceof Error ? e.message : e}`,
			);
		}
	}
}

void tryLoadPluginManifests();
