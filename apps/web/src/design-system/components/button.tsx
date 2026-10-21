/* The button, as typed props instead of class strings.
 *
 * There was one of these per vocabulary — `Button` emitting `.btn` for the
 * shell and `EditorButton` emitting `.cv-btn` for the editor — because the two
 * classes differed in padding, font size, hover and disabled opacity, and this
 * file said that "merging them is a visual decision and belongs with the
 * stylesheet work". `converge-web-design-system` is that work, and it found the
 * two were one button copied and drifted: gap 8 vs 7px, disabled opacity 0.50
 * vs 0.45. There is one now.
 *
 * The class census could not have decided this. It reports one call site for
 * each class, because this file is the only place either is written. Counted
 * through the components instead there are 135 buttons and 110 of them are
 * `sm`, which is why `sm` took the editor's metrics rather than the shell's.
 *
 * The point remains the single application point: a variant is a value the
 * type checker knows, so a typo fails the build instead of rendering an
 * unstyled button, and renaming a class touches one file.
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, JSX, LabelHTMLAttributes } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "@models/core/cn.ts";
import { buttonClass, type Variants } from "./button-recipe.ts";
import { Spinner } from "./spinner.tsx";

export type { ButtonSize, ButtonVariant } from "./button-recipe.ts";

function dataOf({ variant, size }: Variants) {
	return {
		"data-slot": "button",
		"data-variant": variant ?? "secondary",
		"data-size": size ?? "md",
	};
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
	Variants & {
		/** The action is running. The button announces `aria-busy`, shows a spinner
		 *  and ignores presses, but stays focusable so keyboard focus is not dropped
		 *  mid-request. Callers used to spell this `disabled={busy}` plus a
		 *  "Saving…" label, which told assistive tech only that the button was
		 *  unavailable. */
		loading?: boolean;
	};

export function Button({
	variant,
	size,
	loading = false,
	disabled,
	className,
	children,
	...rest
}: ButtonProps): JSX.Element {
	return (
		<BaseButton
			{...dataOf({ variant, size })}
			aria-busy={loading || undefined}
			disabled={disabled || loading}
			focusableWhenDisabled={loading}
			className={cn(buttonClass({ variant, size }), className)}
			{...rest}
		>
			{loading && <Spinner size="xs" className="tw:text-current" />}
			{children}
		</BaseButton>
	);
}

/* An anchor that looks like a button. It exists so the "no variant class in a
 * className" rule can be absolute: one call site is a real link — the render
 * output download — and turning it into a <button> to satisfy a lint would
 * cost middle-click, copy-link and open-in-new-tab. */
export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & Variants;

export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps): JSX.Element {
	return (
		<a
			{...dataOf({ variant, size })}
			className={cn(buttonClass({ variant, size }), className)}
			{...rest}
		/>
	);
}

/* A label that looks like a button, for the one site that wraps a hidden file
 * input. A <button> cannot open a file picker, so this is the element the
 * markup needs rather than a lint workaround. */
export type ButtonLabelProps = LabelHTMLAttributes<HTMLLabelElement> & Variants;

export function ButtonLabel({ variant, size, className, ...rest }: ButtonLabelProps): JSX.Element {
	return (
		<label
			{...dataOf({ variant, size })}
			className={cn(buttonClass({ variant, size }), className)}
			{...rest}
		/>
	);
}
