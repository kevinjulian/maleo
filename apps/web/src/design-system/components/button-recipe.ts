/* The button's recipe: variants, sizes and the class it resolves to.
 *
 * Apart from button.tsx, as field-recipe.ts is apart from Input, so a module
 * that only needs the class string (the visual foundation board, a link styled
 * as a button) does not load the component and the stylesheet its Spinner
 * imports. */
import { cn } from "@models/core/cn.ts";

/* The variant table is the type, and each variant names a purpose:
 *
 *   primary    the one main action of a surface (ink fill)
 *   secondary  every other action; the default (outlined)
 *   ghost      quiet actions in dense chrome and toolbars
 *   danger     destroys something
 *
 * It had nine (default, dark, light, ghost, ai, danger, primary, segment,
 * bare): `primary` was a second ink recipe beside `dark`, the unnamed default
 * was a fourth look, and nothing used `bare`. Names now say what a button is
 * for, not what colour it is. `segment`, the editor mode switch, became the
 * segmented Tabs: it was a tablist, not a button.
 *
 * Everything visual is here. No legacy class is emitted for another sheet to
 * paint; layout hooks use `[data-slot="button"]`, and `data-variant` /
 * `data-size` expose the choice to tests and contextual CSS. */
const VARIANT = {
	primary:
		"tw:border-transparent tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90 tw:active:bg-primary/80",
	secondary:
		"tw:border-border tw:bg-background tw:text-foreground tw:hover:bg-accent tw:active:bg-pressed",
	ghost:
		"tw:border-transparent tw:bg-transparent tw:text-muted-foreground tw:hover:bg-secondary tw:hover:text-foreground tw:active:bg-pressed",
	danger:
		"tw:border-transparent tw:bg-destructive tw:text-destructive-foreground tw:hover:bg-destructive/90 tw:active:bg-destructive/80",
} as const;
const SIZE = {
	xs: "tw:min-h-[var(--control-h-xs)] tw:px-2 tw:text-xs",
	sm: "tw:min-h-[var(--control-h-sm)] tw:px-3 tw:text-xs",
	md: "tw:min-h-[var(--control-h)] tw:px-4 tw:text-sm",
} as const;
const RECIPE =
	"tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:whitespace-nowrap tw:rounded-md tw:border tw:font-sans tw:font-semibold tw:cursor-pointer tw:no-underline tw:transition-colors tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:aria-disabled:pointer-events-none tw:aria-disabled:opacity-50 tw:pointer-coarse:min-h-[var(--control-h-touch)]";

export type ButtonVariant = keyof typeof VARIANT;
export type ButtonSize = keyof typeof SIZE;

export interface Variants {
	variant?: ButtonVariant | null;
	size?: ButtonSize | null;
}

export function buttonClass({ variant, size }: Variants): string {
	return cn(RECIPE, VARIANT[variant ?? "secondary"], SIZE[size ?? "md"]);
}
