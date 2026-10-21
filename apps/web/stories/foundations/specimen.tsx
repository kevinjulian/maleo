/* Shared pieces for the Foundations pages.
 *
 * Every value shown is read from the live stylesheet with getComputedStyle,
 * never typed into a story, so a page cannot drift from tokens.css: change a
 * token and its specimen changes with it. The theme toolbar flips the `dark`
 * class before a story renders, so a read during render sees the active theme.
 *
 * Pages explain a role, then show the token that implements it. Agents and
 * people pick the role; the token name is how they write it. */
import { textOf } from "@maleo/shared";
import type { CSSProperties, JSX, ReactNode } from "react";

export function token(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Resolve any CSS colour (including relative syntax and alpha) to rgba by
 * letting the browser paint it. */
function rgba(color: string): [number, number, number, number] {
	const probe = document.createElement("span");
	probe.style.color = color;
	document.body.append(probe);
	const out = getComputedStyle(probe).color;
	probe.remove();
	const parts = out.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
	return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

function luminance([r, g, b]: [number, number, number, number]): number {
	const lin = (v: number): number => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** `top` painted over an opaque `bottom`, as an rgb() string. */
export function over(top: string, bottom: string): string {
	const t = rgba(top);
	const b = rgba(bottom);
	const a = t[3];
	return `rgb(${[0, 1, 2].map((i) => Math.round(t[i]! * a + b[i]! * (1 - a))).join(", ")})`;
}

/** WCAG contrast of `fg` over `bg`, compositing an alpha foreground first. */
export function contrast(fg: string, bg: string): number {
	const b = rgba(bg);
	const f = rgba(fg);
	const a = f[3];
	const mixed: [number, number, number, number] = [
		f[0] * a + b[0] * (1 - a),
		f[1] * a + b[1] * (1 - a),
		f[2] * a + b[2] * (1 - a),
		1,
	];
	const hi = Math.max(luminance(mixed), luminance(b));
	const lo = Math.min(luminance(mixed), luminance(b));
	return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function Page({
	title,
	lead,
	children,
}: {
	title: string;
	lead: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="tw:flex tw:max-w-[960px] tw:flex-col tw:gap-8 tw:text-foreground">
			<header className="tw:flex tw:flex-col tw:gap-2">
				<h1
					className="tw:m-0"
					style={{
						fontSize: "var(--type-subsection-size)",
						lineHeight: "var(--type-subsection-lh)",
						fontWeight: "var(--weight-strong)",
					}}
				>
					{title}
				</h1>
				<p className="tw:m-0 tw:max-w-[640px] tw:text-sm tw:text-muted-foreground">{lead}</p>
			</header>
			{children}
		</div>
	);
}

export function Group({
	title,
	note,
	children,
}: {
	title: string;
	note?: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<section className="tw:flex tw:flex-col tw:gap-3">
			<div className="tw:flex tw:flex-col tw:gap-1">
				<h2 className="tw:m-0 tw:text-sm tw:font-semibold">{title}</h2>
				{note && (
					<p className="tw:m-0 tw:max-w-[640px] tw:text-xs tw:text-muted-foreground">{note}</p>
				)}
			</div>
			{children}
		</section>
	);
}

/** One row of a role table: the role, its token, the live value, a specimen. */
export function RoleRow({
	role,
	name,
	use,
	children,
}: {
	role: string;
	name: string;
	use: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] tw:items-center tw:gap-4 tw:border-b tw:border-border tw:py-2 tw:last:border-b-0"
			style={{ borderColor: "var(--border-subtle)" }}
		>
			<div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-0.5">
				<span className="tw:text-sm tw:font-medium">{role}</span>
				<code className="tw:text-xs tw:text-muted-foreground">
					{name}
					{token(name) ? ` · ${token(name)}` : ""}
				</code>
				<span className="tw:text-xs tw:text-muted-foreground">{use}</span>
			</div>
			<div className="tw:min-w-0">{children}</div>
		</div>
	);
}

export function Chip({
	style,
	children,
}: {
	style?: CSSProperties;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="tw:flex tw:h-10 tw:items-center tw:rounded-md tw:px-3 tw:text-xs" style={style}>
			{children}
		</div>
	);
}

/** A pass/fail badge for a contrast ratio against a threshold. */
export function Ratio({ value, min }: { value: number; min: number }): JSX.Element {
	const ok = value >= min;
	return (
		<span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs">
			{value.toFixed(2)}:1 <strong className="tw:font-semibold">{ok ? "pass" : "FAIL"}</strong>
		</span>
	);
}

export function DoDont({
	good,
	bad,
	goodNote,
	badNote,
}: {
	good: ReactNode;
	bad: ReactNode;
	goodNote: ReactNode;
	badNote: ReactNode;
}): JSX.Element {
	return (
		<div className="tw:grid tw:grid-cols-1 tw:gap-4 tw:lg:grid-cols-2">
			{[
				["Do", good, goodNote, "var(--ok)"],
				["Don't", bad, badNote, "var(--err)"],
			].map(([label, body, note, color]) => (
				<figure key={textOf(label)} className="tw:m-0 tw:flex tw:flex-col tw:gap-2">
					<figcaption className="tw:text-xs tw:font-semibold" style={{ color: textOf(color) }}>
						{label}
					</figcaption>
					<div
						className="tw:rounded-md tw:p-4"
						style={{ background: "var(--bg)", border: "1px solid var(--border-subtle)" }}
					>
						{body}
					</div>
					<p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{note}</p>
				</figure>
			))}
		</div>
	);
}
