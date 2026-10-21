/* A labelled control stack: the label/control/help relationship, and nothing
 * else.
 *
 * It had a `variant` prop, and the variant table was four class names — `cv-field`,
 * `tl2-field`, `fc-cap-field`, `settings-field` — because the census had
 * established these were one concept while nothing had yet decided one
 * appearance. That was the right shape for a structural change that was not
 * allowed to move pixels; it is the wrong shape now that `converge-web-design-system`
 * has made the decision. A variant per legacy spelling is the thing task 2.3
 * rejects.
 *
 * One class, `.field`, declared in app/styles/controls.css. What each spelling
 * lost:
 *
 *   - `fc-cap-field` lost nothing: it was `tl2-field` rule for rule.
 *   - `settings-field` kept its `max-width`, its `margin-bottom` and its own
 *     `input`/`select` styling as `.settings-form-field` on the FORM, because a
 *     measure and a rhythm are the form's business. A field that carries its own
 *     width is what made one field look like four.
 *   - `cv-field` was `display: block` — not a smaller field but the absence of
 *     one. Its callers now get the stack their contents used to fake, and their
 *     bare-span labels get the micro-label the rest of the app already had
 *     instead of the inherited 16px they were rendering at.
 *
 * The label stays in the caller's children rather than becoming a prop. The
 * reason has changed, though: it is no longer that the four treatments disagree,
 * it is that a field's head is sometimes a row — a label beside a tag, or beside
 * a reset control — and a `label` string prop cannot hold that.
 */
import type { HTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";

export type FieldProps = HTMLAttributes<HTMLElement> & {
	/** Most fields wrap their control in a `label`; a few are a `div` or `span`. */
	as?: "label" | "div" | "span";
};

export function Field({ as = "label", className, ...rest }: FieldProps): JSX.Element {
	const Tag = as;
	return (
		<Tag className={cn("field tw:flex tw:min-w-0 tw:flex-col tw:gap-2", className)} {...rest} />
	);
}
