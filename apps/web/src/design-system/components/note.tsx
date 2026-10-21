/* An advisory line beside a control. Text, with no box of its own.
 *
 * This had a `variant` axis — `settings` emitting `.settings-note` and
 * `timeline` emitting `.tl2-dsec-note` — because the two clusters spelled the
 * same paragraph differently and at different sizes, and it left the question
 * open: "converge-web-design-system owns whether 11px/1.5 muted and 12px/1.6
 * should stay two sizes."
 *
 * They should not. There is one `.note` now at the caption role, and the
 * variant axis is gone: a cluster is not a variant. The timeline's 11px moves
 * to 12px, which is the smaller half of the split by call sites.
 *
 * Tone survives, and gained the two the old classes could not express. It is a
 * modifier because the old `.settings-field-warn` was never written alone — all
 * five call sites spelled it `settings-field-warn settings-note`, a tone that
 * forgot to say so.
 *
 * `Callout` is NOT this component, and that stays a decision rather than an
 * oversight. It has a border, a fill and padding where Note is a line of text;
 * folding it in would need a variant that switches the box on and off, which
 * `design.md` names as the dishonest outcome.
 */
import type { HTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";

/* The Caption role in a tone's colour. Its look used to be `.note` and three
 * tone modifiers in controls.css; it is all here now. */
const NOTE = "tw:m-0 tw:text-[length:var(--type-caption-size)] tw:leading-[var(--type-caption-lh)]";
const NOTE_TONE = {
	plain: "tw:text-[var(--fg-dim)]",
	muted: "tw:text-muted-foreground",
	warn: "tw:text-warning",
	error: "tw:text-destructive",
} as const;

export type NoteTone = keyof typeof NOTE_TONE;

export type NoteProps = HTMLAttributes<HTMLElement> & {
	tone?: NoteTone;
	/** Most notes are a `p`; the ones inside a field label are a `span`. */
	as?: "p" | "span" | "div";
};

export function Note({ tone = "plain", as = "p", className, ...rest }: NoteProps): JSX.Element {
	const Tag = as;
	return (
		<Tag
			data-slot="note"
			data-tone={tone}
			className={cn(NOTE, NOTE_TONE[tone], className)}
			{...rest}
		/>
	);
}

/* A condition that owns a block of the layout, which is what Note is not.
 *
 * Was the class `cv-provider-warning`, written directly at six call sites — a
 * name describing one caller rather than a job, on a component with no single
 * application point at all. */
const CALLOUT_TONE = {
	warn: "tw:border-[color-mix(in_srgb,var(--warn)_25%,transparent)] tw:bg-[var(--warn-bg)] tw:text-[var(--warn)]",
	error:
		"tw:border-[color-mix(in_srgb,var(--err)_25%,transparent)] tw:bg-[var(--err-bg)] tw:text-[var(--err)]",
	info: "tw:border-[color-mix(in_srgb,var(--info)_25%,transparent)] tw:bg-[var(--info-bg)] tw:text-[var(--info)]",
} as const;

export type CalloutTone = keyof typeof CALLOUT_TONE;

export type CalloutProps = HTMLAttributes<HTMLElement> & {
	tone?: CalloutTone;
	as?: "p" | "div";
};

export function Callout({
	tone = "warn",
	as = "p",
	className,
	...rest
}: CalloutProps): JSX.Element {
	const Tag = as;
	return (
		<Tag
			data-slot="callout"
			data-tone={tone}
			className={cn(
				"tw:m-0 tw:block tw:rounded-md tw:border tw:px-2.5 tw:py-2 tw:text-xs",
				CALLOUT_TONE[tone],
				className,
			)}
			{...rest}
		/>
	);
}
