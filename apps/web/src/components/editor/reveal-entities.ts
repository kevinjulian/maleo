/* Taking the user to what a chat run changed, in the workspaces that render
 * their entities as DOM (slides, posts).
 *
 * Each entity card carries `data-entity-key` with its stable key. A card that is
 * a button selects itself on click — which is how the slide strip opens a slide
 * — so revealing clicks it; anything else is scrolled to and its first control
 * focused. The timeline reveals clips through its own selection instead. */
import type { ChatEntityRef } from "@maleo/shared";

export function revealEntities(
	refs: readonly ChatEntityRef[],
	root: ParentNode = document,
): boolean {
	const reduced =
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	for (const ref of refs) {
		const el = root.querySelector<HTMLElement>(`[data-entity-key="${CSS.escape(ref.id)}"]`);
		if (!el) continue;
		el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
		if (el instanceof HTMLButtonElement) el.click();
		else el.querySelector<HTMLElement>("textarea, input, button")?.focus();
		return true;
	}
	return false;
}
