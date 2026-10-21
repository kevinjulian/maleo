import { z } from "zod";
import { sourceInterval, sceneVisualSourceDuration } from "./source-interval.ts";
import { clipAnimationSchema } from "./clip-animation.ts";

export const processedAudioSchema = z
	.object({
		url: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/),
		sourceUrl: z.string().min(1),
		sourceRevision: z.string().min(1),
		startSec: z.number().finite().min(0),
		durationSec: z.number().finite().positive(),
		playbackRate: z.number().finite().min(0.25).max(4),
		preservePitch: z.boolean(),
		reverse: z.boolean(),
	})
	.strict();
export type ProcessedAudio = z.infer<typeof processedAudioSchema>;
export interface SourceAudioSettings {
	playbackRate?: number;
	preservePitch?: boolean;
	reverse?: boolean;
	audioMedia?: ProcessedAudio;
}

/** A finished derivative samples forward at 1x, including contained later trims. */
export function processedAudioSource(
	url: string,
	start: number,
	duration: number,
	settings: SourceAudioSettings,
) {
	const rate = settings.playbackRate ?? 1;
	if (rate === 1 && !settings.reverse) return { url, mediaStartSec: start };
	const parsed = processedAudioSchema.safeParse(settings.audioMedia);
	if (!parsed.success) return undefined;
	const media = parsed.data;
	if (
		media.sourceUrl !== url ||
		media.playbackRate !== rate ||
		media.preservePitch !== Boolean(settings.preservePitch) ||
		media.reverse !== Boolean(settings.reverse)
	)
		return undefined;
	let interval: ReturnType<typeof sourceInterval>;
	try {
		interval = sourceInterval(start, duration, rate);
	} catch {
		return undefined;
	}
	if (
		interval.start < media.startSec - 1e-6 ||
		interval.end > media.startSec + media.durationSec + 1e-6
	)
		return undefined;
	return {
		url: media.url,
		mediaStartSec: Math.max(
			0,
			(media.reverse
				? media.startSec + media.durationSec - interval.end
				: interval.start - media.startSec) / rate,
		),
	};
}

/** Only measured admitted metadata can declare an originally silent source. The
 *  asset is the one `mediaAssetId` names when it is given and held; the URL
 *  finds it only for a reference without one (a render row carries just a URL). */
export function mediaHasAudio(
	assets: unknown,
	url: string,
	mediaAssetId?: string,
): boolean | undefined {
	if (!Array.isArray(assets)) return undefined;
	const schema = z.object({
		id: z.string().optional(),
		url: z.string(),
		metadata: z.object({ hasAudio: z.boolean().optional() }).optional(),
	});
	const parsed = assets.flatMap((raw) => {
		const value = schema.safeParse(raw);
		return value.success ? [value.data] : [];
	});
	const asset =
		(mediaAssetId === undefined ? undefined : parsed.find((value) => value.id === mediaAssetId)) ??
		parsed.find((value) => value.url === url);
	return asset?.metadata?.hasAudio;
}

/** Check authored inputs before projection can remove unresolved sound. */
export function sourceAudioBlockers(input: unknown, assets?: unknown): string[] {
	const blockers: string[] = [],
		object = z.record(z.unknown());
	const settingsSchema = z.object({
		playbackRate: z.number().optional(),
		preservePitch: z.boolean().optional(),
		reverse: z.boolean().optional(),
		audioMedia: processedAudioSchema.optional(),
	});
	const visit = (value: unknown, parentLayout?: unknown, parentDuration?: number): void => {
		if (Array.isArray(value)) {
			for (const item of value) {
				const row = object.safeParse(item);
				const local = row.success ? object.safeParse(row.data.layout) : undefined,
					parent = object.safeParse(parentLayout);
				const layout = {
					...(parent.success ? parent.data : {}),
					...(local?.success ? local.data : {}),
				};
				visit(
					value.length === 1 &&
						parentDuration != null &&
						row.success &&
						!(typeof row.data.startSec === "number" && row.data.startSec > 0)
						? {
								...row.data,
								durationSec: sceneVisualSourceDuration(
									typeof row.data.durationSec === "number" ? row.data.durationSec : parentDuration,
									parentDuration,
									layout,
								),
							}
						: item,
					parentLayout,
					parentDuration,
				);
			}
			return;
		}
		const parsed = object.safeParse(value);
		if (!parsed.success) return;
		const row = parsed.data,
			inherited = object.safeParse(parentLayout),
			local = object.safeParse(row.layout);
		const layout = {
			...(inherited.success ? inherited.data : {}),
			...(local.success ? local.data : {}),
		};
		const duration =
			typeof row.durationSec === "number"
				? row.durationSec
				: typeof row.dur === "number"
					? row.dur
					: parentDuration;
		const audio = ["voiceover", "music", "sfx", "ambient", "accent_hit"].includes(String(row.kind));
		const settings = audio ? row : layout;
		const retimed = audio
			? (settings.playbackRate ?? 1) !== 1 || settings.reverse === true
			: settings.preservePitch !== undefined && (settings.playbackRate ?? 1) !== 1;
		const animation = clipAnimationSchema.safeParse(settings.animation);
		const hasGain =
			row.volume !== 0 || (animation.success && animation.data.tracks.volume?.some((k) => k.v > 0));
		if (
			typeof row.url === "string" &&
			retimed &&
			row.kind !== "image" &&
			!layout.sourceAudioExtraction &&
			hasGain &&
			(audio ||
				mediaHasAudio(
					assets,
					row.url,
					typeof row.mediaAssetId === "string" ? row.mediaAssetId : undefined,
				) !== false)
		) {
			const config = settingsSchema.safeParse(settings);
			if (
				!config.success ||
				duration == null ||
				!processedAudioSource(
					row.url,
					typeof row.mediaStartSec === "number" ? row.mediaStartSec : 0,
					duration,
					config.data,
				)
			)
				blockers.push(
					`${typeof row.label === "string" ? row.label : "Media clip"}: processed audio is unavailable or changed. Process this source range again before export.`,
				);
		}
		for (const [key, child] of Object.entries(row)) {
			if (key === "layout" || key === "audioMedia" || key === "reverseMedia") continue;
			visit(
				child,
				key === "visualClips" ? layout : undefined,
				key === "visualClips" ? duration : undefined,
			);
		}
	};
	visit(input);
	return [...new Set(blockers)];
}

/** Carry only authored source controls across agent wire/timeline boundaries. */
export function sourceAudioSettings(source: SourceAudioSettings): SourceAudioSettings {
	return {
		...(source.playbackRate === undefined ? {} : { playbackRate: source.playbackRate }),
		...(source.preservePitch === undefined ? {} : { preservePitch: source.preservePitch }),
		...(source.reverse === undefined ? {} : { reverse: source.reverse }),
		...(source.audioMedia === undefined ? {} : { audioMedia: source.audioMedia }),
	};
}
