/* Mount a preview only once it is near the viewport.
 *
 * Every element tile renders a Remotion `Player`, and a Player brings a real
 * media graph with it. Mounting the whole catalogue eagerly cost 49 Players and
 * 245 `<audio>` elements carrying base64 data URIs on one page — measured, not
 * guessed — against 0 on a library page without tiles. Silent catalogue Players
 * now omit shared audio tags; lazy mounting still limits the live renderer count.
 *
 * The placeholder reserves the tile's exact box, so nothing reflows when the
 * real preview arrives and the observer cannot be re-triggered by its own layout
 * shift. Once mounted a tile stays mounted: unmounting a Player to save memory
 * would restart its media on the way back, which is worse than the memory.
 *
 * `rootMargin` is generous on purpose — a tile should be ready by the time it is
 * scrolled to, not start loading when it arrives.
 */
import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

export function LazyPreview({
	children,
	className,
}: {
	children: () => ReactNode;
	className?: string;
}): JSX.Element {
	const host = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(false);

	useEffect(() => {
		if (shown) return;
		const node = host.current;
		if (!node) return;
		/* No IntersectionObserver — a jsdom-ish or very old environment. Showing
		 * the preview is the right failure: a catalogue of empty boxes is worse
		 * than an expensive one. */
		if (typeof IntersectionObserver === "undefined") {
			setShown(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setShown(true);
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [shown]);

	return (
		<div ref={host} className={className}>
			{shown ? children() : null}
		</div>
	);
}
