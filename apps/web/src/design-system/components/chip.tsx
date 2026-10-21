/* The chip: a short rounded inline element carrying a label.
 *
 * Two variants, each a job:
 *   tag     a status or category badge — tinted by `tone`, Label type
 *   inline  a filter pill that can hold a small control (a select), in the
 *           timeline's editing chrome
 * and two elements: `Chip` (static) and `ChipButton` (pressable, a real
 * <button>, which announces its `on` state with `aria-pressed`).
 *
 * The whole look is here. It used to emit `pill` / `interactive` / `on` and tone
 * classes, and `inline` was drawn by the timeline's editing.css under
 * `fc-em-chip`; those classes and rules are retired. Hooks use
 * `[data-slot="chip"]` with `data-variant` and `data-tone`.
 */
import type { ButtonHTMLAttributes, HTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";

const BASE =
	"tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-transparent tw:text-[length:var(--type-label-size)] tw:whitespace-nowrap";
const CHIP_VARIANT = {
	tag: "tw:bg-[var(--chip-bg,var(--surface-tint))] tw:px-2 tw:py-0.5 tw:font-semibold tw:text-[var(--chip-fg,var(--muted))]",
	inline:
		"tw:max-w-full tw:bg-secondary tw:px-2 tw:py-1 tw:text-[var(--fg-dim)] tw:[&_svg]:text-muted-foreground tw:[&_select]:min-w-0 tw:[&_select]:max-w-32",
} as const;

/* Tones are the semantic status roles, each its own wash and text. */
const CHIP_TONE = {
	plain: "",
	ok: "tw:[--chip-bg:var(--ok-bg)] tw:[--chip-fg:var(--ok)]",
	warn: "tw:[--chip-bg:var(--warn-bg)] tw:[--chip-fg:var(--warn)]",
	err: "tw:[--chip-bg:var(--err-bg)] tw:[--chip-fg:var(--err)]",
	info: "tw:[--chip-bg:var(--info-bg)] tw:[--chip-fg:var(--info)]",
	accent: "tw:[--chip-bg:var(--accent-bg)] tw:[--chip-fg:var(--accent)]",
} as const;

const SELECTED =
	"tw:border-ai-border tw:bg-[var(--ai-bg)] tw:text-ai tw:[--chip-bg:var(--ai-bg)] tw:[--chip-fg:var(--ai)]";
const PRESSABLE =
	"tw:cursor-pointer tw:transition-colors tw:hover:border-ai-border tw:hover:text-ai tw:active:bg-pressed tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)]";

export type ChipVariant = keyof typeof CHIP_VARIANT;
export type ChipTone = keyof typeof CHIP_TONE;

export function chipClass(tone: ChipTone = "plain"): string {
	return cn(BASE, CHIP_VARIANT.tag, CHIP_TONE[tone]);
}

export type ChipProps = HTMLAttributes<HTMLElement> & {
	variant?: ChipVariant;
	/** `tag` only — a filter pill has no status. */
	tone?: ChipTone;
	/** Selected look for a static inline pill (the filter it names is active). */
	on?: boolean;
	as?: "span" | "div" | "label";
};

export function Chip({
	variant = "tag",
	tone = "plain",
	on,
	as = "span",
	className,
	...rest
}: ChipProps): JSX.Element {
	const Tag = as;
	return (
		<Tag
			data-slot="chip"
			data-variant={variant}
			data-tone={variant === "tag" ? tone : undefined}
			className={cn(
				BASE,
				CHIP_VARIANT[variant],
				variant === "tag" && CHIP_TONE[tone],
				on && SELECTED,
				className,
			)}
			{...rest}
		/>
	);
}

export type ChipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ChipVariant;
	/** A toggle's state, announced with `aria-pressed`. Omit for a plain action. */
	on?: boolean;
};

export function ChipButton({
	variant = "tag",
	on,
	className,
	...rest
}: ChipButtonProps): JSX.Element {
	return (
		<button
			type="button"
			data-slot="chip"
			data-variant={variant}
			aria-pressed={on}
			className={cn(
				BASE,
				CHIP_VARIANT[variant],
				variant === "tag" && "tw:border-input",
				PRESSABLE,
				on && SELECTED,
				className,
			)}
			{...rest}
		/>
	);
}
