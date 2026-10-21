/* Browser-decoded audio waveform for timeline clips (clip-first).
 *
 * Decode through @remotion/media-utils first, then raw Web Audio. Results are
 * cached per url — the same clip never re-decodes. MediaBunny's HLS probing can
 * emit unhandled browser fetch rejections for inaccessible/CDN assets, so the
 * timeline waveform avoids it and degrades to the label when decoding fails. */
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { getAudioData, getWaveformPortion } from "@remotion/media-utils";
import { mediaCredentials } from "@models/core/cc-helpers.ts";
import { decodableAudioUrl } from "@models/timeline/audio-decode-url.ts";
import { displayPeaks } from "@models/timeline/waveform-bars.ts";

// Decode once at high resolution; each clip downsamples to its own width so a
// long clip isn't stuck with a blocky 64-bar strip and a short one isn't wasteful.
const BARS = 256;
const cache = new Map<string, { peaks: number[]; duration: number }>();
const pending = new Map<string, Promise<{ peaks: number[]; duration: number }>>();

async function decode(rawUrl: string): Promise<{ peaks: number[]; duration: number }> {
	/* Decode from a SAME-ORIGIN url. Playback does not need one, decoding does:
	 * the stock music bucket sends no CORS header, so every music clip fell back
	 * to its label while `/uploads` audio drew a waveform. Cached under the
	 * decodable url so one track decodes once however it was addressed. */
	const url = decodableAudioUrl(rawUrl);
	const cached = cache.get(url);
	if (cached) return cached;
	const inflight = pending.get(url);
	if (inflight) return inflight;
	const p = (async () => {
		try {
			const audioData = await getAudioData(url, {
				requestInit: { credentials: mediaCredentials(url) },
			});
			const bars = getWaveformPortion({
				audioData,
				startTimeInSeconds: 0,
				durationInSeconds: audioData.durationInSeconds,
				numberOfSamples: BARS,
				outputRange: "zero-to-one",
				normalize: true,
			});
			const result = {
				peaks: bars.map((bar) => bar.amplitude),
				duration: audioData.durationInSeconds,
			};
			cache.set(url, result);
			return result;
		} catch {
			// Fall through to Web Audio: keeps local/private URLs working if media-utils
			// cannot fetch or parse the asset in this browser.
		}
		const buf = await (await fetch(url, { credentials: mediaCredentials(url) })).arrayBuffer();
		const Ctx = window.AudioContext || window.webkitAudioContext;
		const ctx = new Ctx();
		try {
			const audio = await ctx.decodeAudioData(buf);
			const data = audio.getChannelData(0);
			const bucket = Math.max(1, Math.floor(data.length / BARS));
			const peaks: number[] = [];
			for (let i = 0; i < BARS; i++) {
				let max = 0;
				for (let j = 0; j < bucket; j++) {
					const v = Math.abs(data[i * bucket + j] ?? 0);
					if (v > max) max = v;
				}
				peaks.push(max);
			}
			const norm = Math.max(...peaks, 0.01);
			const result = { peaks: peaks.map((v) => v / norm), duration: audio.duration };
			cache.set(url, result);
			return result;
		} finally {
			void ctx.close();
		}
	})();
	pending.set(url, p);
	try {
		return await p;
	} finally {
		pending.delete(url);
	}
}

/* Paint the bars, mirrored about the centre line.
 *
 * Reads its own colour and opacity from the element's computed style, which is
 * what keeps the canvas inside the cascade: the bars are white on a compact
 * audio clip, the accent colour on the stage, and brighter when the clip is
 * selected — three rules that already exist and that a hard-coded fill here
 * would silently stop obeying.
 *
 * Device pixel ratio is applied to the backing store rather than to the CSS
 * size, or every bar is soft on a retina display. */
function paint(canvas: HTMLCanvasElement, peaks: number[]): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const style = getComputedStyle(canvas);
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (width <= 0 || height <= 0) return;
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = style.color;
	const bars = displayPeaks(peaks, width);
	const step = width / bars.length;
	const barWidth = Math.max(1, step - 1);
	const centre = height / 2;
	for (const [i, peak] of bars.entries()) {
		// The same floor the DOM bars had: a silent passage is still a line,
		// because a gap in a waveform reads as a gap in the audio.
		const h = Math.max(2, Math.min(height, peak * height));
		ctx.fillRect(i * step, centre - h / 2, barWidth, h);
	}
}

// Renders the bars; reports the decoded natural duration once (for the resize %).
// Falls back to the label text while decoding or if the audio can't be decoded,
// so the clip is never blank. `widthPx` (the clip's rendered width) sets the bar
// count so waveform resolution follows zoom and clip length.
export function Waveform({
	url,
	label,
	icon,
	widthPx,
	onDuration,
}: {
	url: string;
	label?: string;
	icon?: JSX.Element;
	widthPx?: number;
	onDuration?: (sec: number) => void;
}): JSX.Element {
	const [decoded, setDecoded] = useState({ url, peaks: cache.get(url)?.peaks ?? null });
	// Immutable playback URL identifies source revision, including while decoding fails.
	const peaks = decoded.url === url ? decoded.peaks : (cache.get(url)?.peaks ?? null);
	useEffect(() => {
		let alive = true;
		void decode(url)
			.then((r) => {
				if (alive) {
					setDecoded({ url, peaks: r.peaks });
					onDuration?.(r.duration);
				}
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url]);
	/* One element, whatever the resolution.
	 *
	 * This was up to 256 `<i>` elements per audio clip, recreated on every
	 * render of the lane holding it — multiplied by the commit count of a click
	 * and, before the playhead moved off React state, by the frame rate during
	 * playback. A canvas makes the cost independent of both.
	 *
	 * The redraw is driven by a ResizeObserver rather than by a render, so
	 * zooming changes the resolution without React being involved at all. */
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !peaks) return;
		paint(canvas, peaks);
		const observer = new ResizeObserver(() => paint(canvas, peaks));
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [peaks, widthPx]);
	if (!peaks)
		return (
			<span className="tl2-wave-fallback">
				{icon}
				<b>{label || "Audio"}</b>
			</span>
		);
	return <canvas ref={canvasRef} className="tl2-wave" aria-hidden />;
}
