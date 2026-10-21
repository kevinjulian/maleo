/** Reader-facing caption times and source names. Internal clip ids never reach a label. */

function clockParts(sec: number) {
	const total = Number.isFinite(sec) && sec > 0 ? sec : 0;
	const whole = Math.floor(total);
	return {
		hours: Math.floor(whole / 3600),
		minutes: Math.floor((whole % 3600) / 60),
		seconds: whole % 60,
	};
}

function joinClock(hours: number, minutes: number, seconds: string): string {
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

/** `m:ss`, or `h:mm:ss` past an hour. Truncates so a cue never reads as the next second. */
export function captionClock(sec: number): string {
	const { hours, minutes, seconds } = clockParts(sec);
	return joinClock(hours, minutes, String(seconds).padStart(2, "0"));
}

/** `m:ss.s`: the cue-row start time. */
export function captionClockTenths(sec: number): string {
	const total = Number.isFinite(sec) && sec > 0 ? sec : 0;
	const { hours, minutes, seconds } = clockParts(total);
	const tenths = Math.floor(Math.round((total - Math.floor(total)) * 1000) / 100);
	return joinClock(hours, minutes, `${String(seconds).padStart(2, "0")}.${tenths}`);
}

export function captionRangeLabel(
	sources: ReadonlyArray<{ startSec: number; durationSec: number }>,
): string | null {
	if (!sources.length) return null;
	const start = Math.min(...sources.map((source) => source.startSec));
	const end = Math.max(...sources.map((source) => source.startSec + source.durationSec));
	return `${captionClock(start)} – ${captionClock(end)}`;
}

interface LabelSource {
	clipId: string;
	visualId?: string;
	url: string;
	mediaAssetId?: string;
	startSec: number;
}

interface LabelAsset {
	id: string;
	url?: string;
	label: string;
}

/** One label per source, in order: media name, else kind and position among that kind. */
export function captionSourceLabels(
	sources: readonly LabelSource[],
	assets: readonly LabelAsset[],
): string[] {
	const counts = { Video: 0, Audio: 0 };
	return sources.map((source) => {
		const kind = source.visualId ? "Video" : "Audio";
		counts[kind] += 1;
		const asset =
			assets.find((item) => source.mediaAssetId && item.id === source.mediaAssetId) ??
			assets.find((item) => item.url === source.url);
		const name = asset?.label.trim() || `${kind} ${counts[kind]}`;
		return `${name} · ${captionClock(source.startSec)}`;
	});
}
