/* The icon button: an action with no text, on the control-height scale.
 *
 * Everything it looks like is here — sizes, the quiet rest state, the pressed
 * toggle (`on`, announced with `aria-pressed`), danger, and the hover, pointer-
 * down, focus, disabled and touch-floor states. It used to emit `.cv-iconbtn`
 * and `.sm` / `.xs` / `.on` / `.danger` modifiers that another stylesheet could
 * restyle, and its `sm` drew the 24px step; sizes now carry the scale's names
 * (`xs` is 24), and no class is emitted for anything else to paint.
 */
import type { ButtonHTMLAttributes, JSX } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "@models/core/cn.ts";

/* Square, on the control-height scale shared with Button and the fields:
 * xs 24 (editor rows, the common case), sm 32 (toolbars), md 40 (forms).
 * `micro` (16) is the remove-glyph inside a chip or context token, and grows to
 * the touch floor like every other size. */
const SIZE = {
	micro: "tw:size-4",
	xs: "tw:size-[var(--control-h-xs)]",
	sm: "tw:size-[var(--control-h-sm)]",
	md: "tw:size-[var(--control-h)]",
} as const;
const RECIPE =
	"tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)] tw:pointer-coarse:min-w-[var(--control-h-touch)]";
/* Rest is quiet; pressed (`on`) is the selection role from foundations — the
 * accent wash and ink — not a dark fill; danger only reddens on hover. */
const QUIET =
	"tw:bg-transparent tw:text-muted-foreground tw:hover:bg-secondary tw:hover:text-foreground tw:active:bg-pressed";
const PRESSED = "tw:bg-[var(--ai-bg)] tw:text-ai tw:hover:bg-[var(--ai-bg)] tw:active:bg-pressed";
const DANGER =
	"tw:bg-transparent tw:text-muted-foreground tw:hover:bg-destructive/10 tw:hover:text-destructive tw:active:bg-pressed";

export type IconButtonSize = keyof typeof SIZE;

/* An icon button has no text, so without one of these it reaches a screen
 * reader as "button" and nothing else. 18 of the 78 call sites had no
 * accessible name at all; making it a type error is what found them, and is
 * what stops the next one being written.
 *
 * Three spellings because the call sites legitimately differ: most want
 * `aria-label`, some already carry a `title` (which also gives a pointer
 * tooltip), and a few point at text that is already on screen. */
type AccessibleName =
	| { "aria-label": string; title?: string; "aria-labelledby"?: never }
	| { title: string; "aria-label"?: string; "aria-labelledby"?: never }
	| { "aria-labelledby": string; "aria-label"?: never; title?: never };

export type IconButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-label" | "title"
> & {
	size?: IconButtonSize;
	/** A toggle's state. When given (true or false) the button is a toggle and
	 *  announces it with `aria-pressed`; omit it for a plain action. */
	on?: boolean;
	/** Destroys something: the hover turns destructive. */
	danger?: boolean;
} & AccessibleName;

export function IconButton({
	size = "md",
	on,
	danger,
	className,
	...rest
}: IconButtonProps): JSX.Element {
	return (
		<BaseButton
			data-slot="icon-button"
			data-size={size}
			aria-pressed={on}
			className={cn(RECIPE, SIZE[size], on ? PRESSED : danger ? DANGER : QUIET, className)}
			{...rest}
		/>
	);
}
