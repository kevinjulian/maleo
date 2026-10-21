import type { HTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";
import "./topbar.css";
export function Topbar({
	variant = "app",
	className,
	...props
}: HTMLAttributes<HTMLElement> & { variant?: "app" | "editor" }): JSX.Element {
	return (
		<header
			data-slot="topbar"
			data-variant={variant}
			className={cn("ui-topbar", className)}
			{...props}
		/>
	);
}
export function TopbarLeading({
	className,
	children,
	...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
	return (
		<div className={cn("ui-topbar-leading", className)} {...props}>
			{typeof children === "string" || typeof children === "number" ? (
				<span className="ui-topbar-title">{children}</span>
			) : (
				children
			)}
		</div>
	);
}
export function TopbarStatus({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
	return <div className={cn("ui-topbar-status", className)} {...props} />;
}
export function TopbarActions({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
	return <div className={cn("ui-topbar-actions", className)} {...props} />;
}
