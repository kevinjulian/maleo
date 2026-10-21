/* Catalogue autoplay honors the browser's reduced-motion preference. */
import { useSyncExternalStore } from "react";
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "@controllers/a11y/motion.ts";

const subscribe = (change: () => void) => {
	if (typeof globalThis.matchMedia !== "function") return () => {};
	const media = globalThis.matchMedia(REDUCED_MOTION_QUERY);
	media.addEventListener("change", change);
	return () => media.removeEventListener("change", change);
};

export function usePreviewFrame(still?: number): number | undefined {
	const reducedMotion = useSyncExternalStore(subscribe, prefersReducedMotion, () => true);
	return still ?? (reducedMotion ? 45 : undefined);
}
