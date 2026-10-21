import type { ComponentProps, JSX } from "react";
import { cn } from "@models/core/cn.ts";
import "./table.css";

/** Native table semantics with shared ledger/inventory spacing. Scrolling belongs to its host. */
export function Table({ className, ...props }: ComponentProps<"table">): JSX.Element {
	return <table {...props} className={cn("ui-table", className)} data-slot="table" />;
}

/** Standard framed table viewport, taken from the AI Explorer detail drawer. */
export function TableScroll({
	label,
	className,
	...props
}: Omit<ComponentProps<"div">, "role" | "tabIndex" | "aria-label"> & {
	label: string;
}): JSX.Element {
	return (
		<div
			{...props}
			className={cn("ui-table-scroll", className)}
			role="region"
			aria-label={label}
			tabIndex={0}
		/>
	);
}
