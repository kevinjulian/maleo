/* The page frame every top-level surface shares: the padded container and the
 * heading inside it.
 *
 * There were two heading idioms before this. `.page-header` in shell.css — a mono
 * eyebrow, an `h1` and an 18px lead — had exactly one live caller (settings), since
 * catalog.tsx only ever renders `embedded` and skips its own header. The other seven
 * surfaces each hand-rolled an `h1` with inline styles, all of them re-declaring
 * `font-display`, 28px and 700 because the base `h1` in typography.css is display
 * scale (clamp 48-80px) and unusable as a page title.
 *
 * So the sizes here are not new design: they are the majority idiom's numbers moved
 * to one place, where changing them is one edit rather than eight.
 *
 * There is no slot above the title. The library surfaces used to put their scope
 * tabs there, which gave those pages two competing headers and made Library the
 * one page family where navigation preceded identity. Sibling-surface navigation
 * now renders after this header, so a caller that wants chrome between the
 * heading and its content simply renders it there.
 */
import type { HTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "@models/core/cn.ts";
import "./page.css";

export interface PageProps {
	children: ReactNode;
	/** Narrower measure for form-shaped surfaces (video, preset editors). */
	width?: "default" | "narrow";
	className?: string;
}

export function Page({ children, width = "default", className }: PageProps): JSX.Element {
	return <div className={cn("pg", width === "narrow" && "pg-narrow", className)}>{children}</div>;
}

/* The title on its own, for the headers that are not this header.
 *
 * Four surfaces build their own title row — a sub-page editor puts it inline
 * with a Back control, the launcher centres it, project setup sits it beside an
 * icon, the storyboard puts it in a toolbar beside approval controls — and none
 * of them can use `PageHeader`, whose anatomy is title/lead/action. Before this
 * they each declared their own type instead: 32px/600, 23px/600, 25px, and a
 * `pg-title-sub` class written straight into two catalog files, which is why
 * that spelling sat in the cross-cluster baseline as a leak.
 *
 * So the level is a typed value and the class stays in the file that owns the
 * stylesheet. `page` is the page-title role; `sub` is the section-title role,
 * for a detail view within a page. */
export type PageTitleLevel = "page" | "sub";

export function PageTitle({
	level = "page",
	className,
	...rest
}: HTMLAttributes<HTMLHeadingElement> & { level?: PageTitleLevel }): JSX.Element {
	return <h1 className={cn(level === "sub" ? "pg-title-sub" : "pg-title", className)} {...rest} />;
}

export interface PageHeaderProps {
	title: string;
	/** Supporting line under the title. */
	lead?: ReactNode;
	/** Page-level controls — a count, a primary action. Aligned with the title. */
	action?: ReactNode;
}

export function PageHeader({ title, lead, action }: PageHeaderProps): JSX.Element {
	return (
		<header className="pg-head">
			<div className="pg-head-row">
				<PageTitle>{title}</PageTitle>
				{action ? <div className="pg-actions">{action}</div> : null}
			</div>
			{lead ? <p className="pg-lead">{lead}</p> : null}
		</header>
	);
}
