/* Join class names, dropping the ones a condition turned off.
 *
 * This was `twMerge(clsx(...))`. Neither package earned its place: `twMerge`
 * resolves conflicts between TAILWIND utilities and this app renders none, so it
 * walked every class to decide nothing; `clsx` handles object and array forms
 * that no call site passes. What the call sites actually pass is a base class, a
 * few `cond && "class"` expressions, and a caller's optional `className`.
 *
 * The function stays even though its body is one line, because the primitives
 * need ONE place a caller's className is merged — `check-layers.ts` rejects the
 * template-literal form for that reason, and the hand-rolled filter/join it
 * replaced was written two different ways in two components.
 */

/** A class name, or a condition that did not produce one. */
export type ClassValue = string | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
	return parts.filter(Boolean).join(" ");
}
