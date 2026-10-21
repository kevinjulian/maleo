/* One group of an account page: a small heading with a one-line explanation,
 * then its rows. Groups are separated by space and a hairline — no box around
 * a group and no card per row. */
import { useId, type JSX, type ReactNode } from "react";
import { Field } from "@design-system/components/field.tsx";
import { Input, type InputProps } from "@design-system/components/input.tsx";

export function AccountGroup({
	title,
	description,
	action,
	children,
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<section className="tw:flex tw:flex-col tw:gap-4 tw:border-t tw:border-border tw:py-6">
			<div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
				<div className="tw:flex tw:flex-col tw:gap-1">
					<h2 className="tw:m-0 tw:text-sm tw:font-semibold">{title}</h2>
					{description && (
						<p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{description}</p>
					)}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

/** The outcome line under a form: an error is an alert, a success is a status. */
export function FormOutcome({
	error,
	done,
}: {
	error: string | null;
	done: string | null;
}): JSX.Element | null {
	if (error)
		return (
			<p role="alert" className="tw:m-0 tw:text-xs tw:text-destructive">
				{error}
			</p>
		);
	if (done)
		return (
			<p role="status" className="tw:m-0 tw:text-xs tw:text-muted-foreground">
				{done}
			</p>
		);
	return null;
}

/* A labelled input whose help sits OUTSIDE the label and is linked by
 * `aria-describedby`. Inside the label, the help would become part of the
 * input's accessible name ("New password At least 12 characters."). */
export function LabelledInput({
	label,
	hint,
	...input
}: InputProps & { label: string; hint?: ReactNode }): JSX.Element {
	const id = useId();
	const hintId = `${id}-hint`;
	return (
		<Field as="div">
			<label htmlFor={id} className="tw:text-sm tw:font-medium">
				{label}
			</label>
			<Input id={id} aria-describedby={hint ? hintId : undefined} {...input} />
			{hint && (
				<span id={hintId} className="tw:text-xs tw:text-muted-foreground">
					{hint}
				</span>
			)}
		</Field>
	);
}
