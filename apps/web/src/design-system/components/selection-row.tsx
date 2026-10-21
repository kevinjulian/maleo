import type { ComponentProps, JSX } from "react";
import { cn } from "@models/core/cn.ts";
import "./selection-row.css";

type SelectionRowProps = { selected?: boolean; layout?: "inline" | "stacked" } & (
	| (ComponentProps<"a"> & { href: string })
	| (ComponentProps<"button"> & { href?: never })
);

/** Full-row navigation with the Providers and Security selection treatment. */
export function SelectionRow(props: SelectionRowProps): JSX.Element {
	if (props.href !== undefined) {
		const { selected, layout, className, ...link } = props;
		return (
			<a
				{...link}
				className={cn("ui-selection-row", className)}
				data-layout={layout}
				aria-current={selected ? "true" : undefined}
			/>
		);
	}
	const { selected, layout, className, ...button } = props;
	return (
		<button
			type="button"
			{...button}
			className={cn("ui-selection-row", className)}
			data-layout={layout}
			aria-current={selected ? "true" : undefined}
		/>
	);
}

export function SelectionRowLabel({ className, ...props }: ComponentProps<"span">): JSX.Element {
	return <span {...props} className={cn("ui-selection-row-label", className)} />;
}
