import type { CSSProperties, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { MediaReadiness } from "@services/preview-media/session.ts";

export type ClipReadiness = MediaReadiness["clips"][number];

export function previewReadinessMessage(clips: readonly ClipReadiness[]): string {
	for (const clip of clips) {
		if (clip.state.state === "failed") return `Preview unavailable: ${clip.state.message}`;
	}
	return clips.length
		? `Loading preview media: ${clips.filter((clip) => clip.state.state === "ready").length} of ${clips.length} clips ready.`
		: "Preparing preview.";
}

/** The visible toolbar form: short enough to sit beside the transport without moving anything. */
export function previewReadinessShort(clips: readonly ClipReadiness[]): string {
	if (clips.some((clip) => clip.state.state === "failed")) return "Preview unavailable";
	const ready = clips.filter((clip) => clip.state.state === "ready").length;
	return clips.length ? `Preparing preview · ${ready}/${clips.length}` : "Preparing preview";
}

export function previewLoadingLabel(clip: ClipReadiness): string {
	switch (clip.state.state) {
		case "queued":
			return "Preview queued";
		case "loading":
			return clip.total != null && clip.total > 0
				? `Loading preview ${Math.min(100, Math.floor((clip.loaded / clip.total) * 100))}%`
				: "Loading preview";
		case "validating":
			return "Validating preview";
		case "ready":
			return "Preview ready";
		case "failed":
			return `Preview failed: ${clip.state.message}`;
	}
}

/**
 * Preview state uses the existing clip badge geometry without owning gestures. A ready clip
 * shows nothing; loading is the progress line alone (compact clips, which hide the line, keep
 * a small loader icon); a failure keeps its warning icon.
 */
export function ClipPreviewBadge({ clip }: { clip: ClipReadiness }): JSX.Element | null {
	const phase = clip.state.state;
	if (phase === "ready") return null;
	const label = previewLoadingLabel(clip);
	const progress =
		phase === "loading" && clip.total != null && clip.total > 0
			? Math.max(0, Math.min(1, clip.loaded / clip.total))
			: null;
	// SAFETY: CSS custom properties are valid React style keys.
	const line = progress == null ? undefined : ({ "--upload-progress": progress } as CSSProperties);
	return (
		<span
			className="tl2-clip-upload"
			data-preview-state={phase}
			data-preview-indeterminate={(phase !== "failed" && progress == null) || undefined}
			role="img"
			aria-label={label}
			title={label}
		>
			<span className="tl2-clip-upload-icon">
				{phase === "failed" ? Ic.warning(ICON.xs) : Ic.loader(ICON.xs)}
			</span>
			{phase !== "failed" && <span className="tl2-clip-upload-line" style={line} />}
		</span>
	);
}
