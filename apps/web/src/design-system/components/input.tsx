/* The text field and the textarea, on the shared field recipe.
 *
 * Their whole look is field-recipe.ts: one box, three sizes (xs editor field,
 * sm compact, md form — the default), and every state. They used to wear
 * `.cv-input` from the editor's stylesheet, which added a second focus
 * treatment (a 3px wash) on top of the ring; that class and its rules are
 * retired, and with them the `standard` variant that existed only to opt out
 * of it.
 */
import type { InputHTMLAttributes, JSX, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "@models/core/cn.ts";
import { fieldClass, NO_SPINNER, type FieldSize } from "./field-recipe.ts";

export type InputSize = FieldSize;
export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: InputSize };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
	{ className, size = "md", ...rest },
	ref,
): JSX.Element {
	return (
		<BaseInput
			ref={ref}
			data-slot="input"
			data-size={size}
			className={cn(fieldClass(size), size === "xs" && NO_SPINNER, className)}
			{...rest}
		/>
	);
});

/* A textarea rather than an `as` prop: the two do not share an attribute set —
 * `rows` is meaningless on an input, `type` on a textarea. Always the md box,
 * with vertical padding because it holds lines, not a single value. */
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
	{ className, ...rest },
	ref,
): JSX.Element {
	return (
		<textarea
			ref={ref}
			data-slot="textarea"
			className={cn(fieldClass("md"), "tw:py-2", className)}
			{...rest}
		/>
	);
});
