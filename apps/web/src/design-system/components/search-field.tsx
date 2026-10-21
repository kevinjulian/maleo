/* The search field: a query, its glyph, and one way to clear it.
 *
 * Search was written about nine ways: an icon positioned over an Input whose
 * padding then lost to the utility layer, so text ran under the glyph (audit
 * F01); bare inputs with no clear control; a second box class in the editor.
 * Here the glyph and the clear control are siblings of the input inside one
 * box, so nothing overlaps by construction. The box is the field recipe drawn
 * on the wrapper, as NumberField does, because the input inside is transparent.
 *
 * Escape clears a non-empty query and keeps focus; the clear control returns
 * focus to the field, so the next keystroke goes where the last one did.
 */
import { useRef } from "react";
import type { InputHTMLAttributes, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { IconButton } from "./icon-button.tsx";

const BOX =
	"tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-transparent tw:bg-secondary tw:text-foreground tw:transition-colors tw:cursor-text tw:hover:bg-accent tw:focus-within:bg-[var(--surface-raised)] tw:focus-within:outline-2 tw:focus-within:outline-offset-2 tw:focus-within:outline-ring tw:has-[:disabled]:opacity-50 tw:has-[:disabled]:hover:bg-secondary tw:pointer-coarse:min-h-[var(--control-h-touch)]";
const SIZE = {
	sm: "tw:min-h-[var(--control-h-sm)] tw:ps-2.5 tw:pe-1 tw:text-xs",
	md: "tw:min-h-[var(--control-h)] tw:ps-3 tw:pe-1.5 tw:text-sm",
} as const;
const INPUT =
	"tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-foreground tw:outline-none tw:placeholder:text-muted-foreground tw:disabled:cursor-not-allowed tw:[&::-webkit-search-cancel-button]:appearance-none";

export type SearchFieldProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type" | "value" | "onChange" | "size" | "aria-label"
> & {
	value: string;
	onValueChange: (value: string) => void;
	/** Names what is searched, for assistive tech; also the placeholder unless
	 *  one is given. "Search materials". */
	label: string;
	size?: keyof typeof SIZE;
};

export function SearchField({
	value,
	onValueChange,
	label,
	size = "md",
	placeholder,
	className,
	onKeyDown,
	...rest
}: SearchFieldProps): JSX.Element {
	const input = useRef<HTMLInputElement>(null);
	const clear = (): void => {
		onValueChange("");
		input.current?.focus();
	};
	return (
		<div
			role="presentation"
			data-slot="search-field"
			data-size={size}
			className={cn(BOX, SIZE[size], className)}
			onClick={(e) => {
				if (e.target === e.currentTarget) input.current?.focus();
			}}
		>
			<span aria-hidden="true" className="tw:flex tw:shrink-0 tw:text-muted-foreground">
				{Ic.search(size === "sm" ? ICON.sm : ICON.md)}
			</span>
			<input
				ref={input}
				type="search"
				aria-label={label}
				placeholder={placeholder ?? label}
				value={value}
				className={cn(INPUT, size === "sm" ? "tw:text-xs" : "tw:text-sm")}
				onChange={(e) => onValueChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && value !== "") {
						e.preventDefault();
						clear();
					}
					onKeyDown?.(e);
				}}
				{...rest}
			/>
			{value !== "" && (
				<IconButton size="xs" data-slot="search-clear" aria-label="Clear search" onClick={clear}>
					{Ic.x(ICON.sm)}
				</IconButton>
			)}
		</div>
	);
}
