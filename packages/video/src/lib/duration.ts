// Total storyboard length in seconds. Honors absolute scene starts (gaps) when
// present, else packs scenes sequentially; also covers trailing overlay/audio clips
// so the composition never cuts off content that extends past the last scene.

export type DurScene = { durationSec: number; startSec?: number | null };
type Span = { startSec: number; durationSec: number };

export function storyboardSeconds(props: {
	scenes: DurScene[];
	videoOverlays?: Span[];
	textOverlays?: Span[];
	infographicOverlays?: Span[];
	audioOverlays?: Span[];
	visualTimeline?: Span[];
}): number {
	const hasExplicit = props.scenes.some((s) => s.startSec != null);
	let cursor = 0;
	let end = 0;
	for (const s of props.scenes) {
		const start = hasExplicit ? (s.startSec ?? cursor) : cursor;
		cursor = start + s.durationSec;
		end = Math.max(end, cursor);
	}
	for (const o of [
		...(props.videoOverlays ?? []),
		...(props.textOverlays ?? []),
		...(props.infographicOverlays ?? []),
		...(props.audioOverlays ?? []),
		...(props.visualTimeline ?? []),
	]) {
		end = Math.max(end, o.startSec + o.durationSec);
	}
	return end;
}

/** Source in-point in frames. Audio and video share this one rounding so a split
 *  at any frame boundary keeps both halves' sound and picture on the same frame. */
export function sourceStartFrame(mediaStartSec: number | undefined, fps: number): number {
	return Math.round((mediaStartSec ?? 0) * fps);
}
