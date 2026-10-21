/* An identity mark: initials on a fill. A person is a circle on ink; a
 * workspace is a square on its own colour. One component, so the two cannot
 * drift into different sizes and type the way `Avatar` and the switcher's own
 * chip had.
 *
 * No image: accounts carry none, so Base UI's avatar — whose job is falling
 * back from a failed image — has nothing to do here. Decorative (aria-hidden);
 * the name is always printed beside it or carried by the control around it. */
import type { JSX } from "react";
import { cn } from "@models/core/cn.ts";

export function initialsOf(name: string): string {
	const words = name
		.trim()
		.split(/[\s._@-]+/)
		.filter(Boolean);
	const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
	return letters.toUpperCase();
}

const SIZE = {
	sm: "tw:size-6 tw:text-[length:var(--type-label-size)]",
	md: "tw:size-7 tw:text-xs",
} as const;

export type AvatarProps = {
	name: string;
	/** Initials the owner already derived (the workspace registry does);
	 *  otherwise they come from `name`. */
	initials?: string;
	/** The identity's own colour. With one, the mark is that colour under
	 *  `--on-identity`; without, it is ink. Data, so it is an inline style. */
	color?: string;
	/** `circle` for a person, `square` for a workspace. */
	shape?: "circle" | "square";
	size?: keyof typeof SIZE;
	className?: string;
};

export function Avatar({
	name,
	initials,
	color,
	shape = "circle",
	size = "md",
	className,
}: AvatarProps): JSX.Element {
	return (
		<span
			aria-hidden="true"
			data-slot="avatar"
			data-shape={shape}
			style={color ? { background: color } : undefined}
			className={cn(
				"tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:font-semibold tw:leading-none",
				SIZE[size],
				shape === "square" ? "tw:rounded-md" : "tw:rounded-full",
				color ? "tw:text-[var(--on-identity)]" : "tw:bg-primary tw:text-primary-foreground",
				className,
			)}
		>
			{initials ?? initialsOf(name)}
		</span>
	);
}
