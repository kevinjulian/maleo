/* One synthesis in the feed: its clip, and what it says.
 *
 * The image lab's ChatBubble with the medium swapped. Same column width, same
 * order — artifact first, then the text that produced it, then a mono metadata
 * line with reuse beside it — because the two labs are one surface and only the
 * medium differs.
 *
 * Where the image bubble shows an aspect-shaped image, this shows a player of the
 * same footprint. A clip cannot be recognised at a glance the way an image can,
 * so the play control is the artifact here.
 */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { LedgerClip } from "@models/speech/clip.ts";
import { formatClipDuration } from "@models/speech/gallery-filters.ts";

export function SpeechBubble({
	clip,
	playing,
	onPlay,
	onReuse,
}: {
	clip: LedgerClip;
	playing: boolean;
	onPlay: () => void;
	onReuse: (text: string) => void;
}): JSX.Element {
	// A recovered clip whose file never landed, or one whose synthesis failed
	// after being billed. The row stays; the control does not pretend to work.
	const missing = !clip.asset_url;

	return (
		<div className="spklab-bubble">
			<div className="spklab-stage">
				<button
					type="button"
					className="spklab-stage-play"
					disabled={missing}
					aria-label={`${playing ? "Stop" : "Play"} clip`}
					onClick={onPlay}
				>
					{playing ? Ic.x(ICON.xl) : Ic.play(ICON.xl)}
				</button>
				<span className="spklab-stage-dur">
					{missing ? "unavailable" : formatClipDuration(clip.duration_sec)}
				</span>
			</div>

			<div className="spklab-said">
				<div className="spklab-said-text">{clip.prompt}</div>
				<div className="mono spklab-said-meta">
					{new Date(clip.created_at).toLocaleTimeString()}
					{clip.voice ? ` · ${clip.voice}` : ""}
					{clip.provider ? ` · ${clip.provider}` : ""}
				</div>
			</div>

			{clip.prompt ? (
				<button
					type="button"
					className="spklab-reuse"
					title="Reuse text"
					aria-label="Reuse text"
					onClick={() => onReuse(clip.prompt ?? "")}
				>
					{Ic.repeat(ICON.sm)}
				</button>
			) : null}
		</div>
	);
}
