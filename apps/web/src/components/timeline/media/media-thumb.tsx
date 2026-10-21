/* Videos without an admitted thumbnail show their first frame. Loading a poster
 * must not write clip edits or consume an undo step. */
import type { JSX } from "react";

/* iOS Safari loads only metadata for a paused `preload="metadata"` video and
 * never paints a frame, so the strip stayed blank on phones. A media fragment
 * just past zero makes it seek, which decodes and paints the first frame. */
export function posterSrc(url: string): string {
	return url.includes("#") ? url : `${url}#t=0.001`;
}

export function VideoPoster({ url }: { url: string }): JSX.Element {
	return (
		<video
			className="tl2-clip-strip video"
			src={posterSrc(url)}
			muted
			playsInline
			preload="metadata"
		/>
	);
}
