/* The editor number field: a value with a scrub handle and a unit.
 *
 * Ported from OpenCut classic's NumberField (apps/web/src/design-system/components/
 * number-field.tsx, MIT, Copyright 2025-2026 OpenCut; license text in
 * apps/web/third-party/opencut-classic-license.txt). What came across is the
 * behaviour: drag the prefix to scrub under pointer lock, a unit beside the
 * value, select-all on the first click, Enter to commit. What did not:
 *
 *   - its inline reset. PropertyRow owns reset; two places to reset one value
 *     is one too many.
 *   - expression input. It needs an evaluator the original did not ship here.
 *   - the focusable "Drag to adjust value" button. Scrubbing is a pointer
 *     gesture; the keyboard already steps a native number input with the arrow
 *     keys, so the handle is decoration to assistive tech and stays out of the
 *     tab order.
 *   - Radix, hugeicons and its Button. The box is our editor field, drawn on
 *     the wrapper because the input inside it is transparent.
 */
import { useRef } from "react";
import type { MouseEvent } from "react";
import type { InputHTMLAttributes, JSX, PointerEvent, ReactNode } from "react";
import { cn } from "@models/core/cn.ts";

/* The editor field (select.tsx) with its states moved to the wrapper, which is
 * what the eye reads as the field. */
const FIELD_BOX =
	"tw:flex tw:w-full tw:min-w-0 tw:items-center tw:min-h-[var(--control-h-xs)] tw:rounded-md tw:border tw:border-transparent tw:bg-secondary tw:text-xs tw:text-foreground tw:transition-colors tw:hover:bg-accent tw:focus-within:bg-[var(--surface-raised)] tw:focus-within:outline-1 tw:focus-within:-outline-offset-1 tw:focus-within:outline-ring tw:has-[:disabled]:opacity-50 tw:has-[:disabled]:hover:bg-secondary tw:has-[[aria-invalid=true]]:border-destructive tw:pointer-coarse:min-h-[var(--control-h-touch)]";
const INPUT =
	"tw:min-w-0 tw:flex-1 tw:supports-[field-sizing:content]:flex-none tw:supports-[field-sizing:content]:[field-sizing:content] tw:supports-[field-sizing:content]:min-w-[2ch] tw:border-0 tw:bg-transparent tw:px-1.5 tw:py-0 tw:font-sans tw:text-xs tw:tabular-nums tw:text-foreground tw:outline-none tw:disabled:cursor-not-allowed tw:[appearance:textfield] tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none";
/* The unit follows the value, as in the original. It measured the text with a
 * hidden mirror to place the unit; `field-sizing: content` sizes the input to
 * its value instead, where supported. Elsewhere the input fills and the unit
 * sits at the field's end, which is legible, just less tidy. */
const AFFIX = "tw:shrink-0 tw:select-none tw:px-1.5 tw:text-xs tw:text-muted-foreground";

/** A value `pixels` of horizontal drag away from `start`: one step per pixel,
 *  clamped, and rounded to the step's precision so 0.1-steps stay clean. */
export function scrubValue({
	start,
	pixels,
	step,
	min,
	max,
}: {
	start: number;
	pixels: number;
	step: number;
	min?: number;
	max?: number;
}): number {
	const raw = start + pixels * step;
	const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, raw));
	const decimals = (String(step).split(".")[1] ?? "").length;
	return Number((Math.round(clamped / step) * step).toFixed(decimals));
}

export type NumberFieldProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type" | "value" | "defaultValue" | "onChange" | "size" | "min" | "max" | "step" | "prefix"
> & {
	value: number;
	onValueChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	/** A letter or glyph before the value. Present means scrubbable. */
	icon?: ReactNode;
	/** The unit after the value: "%", "s", "°". */
	suffix?: string;
	/** Called once when a scrub ends, for callers that commit on release. */
	onScrubEnd?: () => void;
};

export function NumberField({
	value,
	onValueChange,
	min,
	max,
	step = 1,
	icon,
	suffix,
	onScrubEnd,
	disabled,
	className,
	onFocus,
	onKeyDown,
	...rest
}: NumberFieldProps): JSX.Element {
	const drag = useRef<{ start: number; pixels: number } | null>(null);
	const input = useRef<HTMLInputElement>(null);
	/* A content-sized input leaves empty field to its right; a click there is
	 * still a click in the field. */
	const focusInput = (e: MouseEvent<HTMLDivElement>): void => {
		if (e.target === e.currentTarget) input.current?.focus();
	};

	const begin = (e: PointerEvent<HTMLSpanElement>): void => {
		if (disabled || e.button !== 0) return;
		e.preventDefault();
		drag.current = { start: value, pixels: 0 };
		e.currentTarget.setPointerCapture(e.pointerId);
		/* Pointer lock keeps the drag going past the screen edge. It can be
		 * refused (an iframe without the permission, a browser setting); capture
		 * alone still scrubs, just bounded by the screen. */
		void Promise.resolve(e.currentTarget.requestPointerLock?.()).catch(() => {});
	};
	const move = (e: PointerEvent<HTMLSpanElement>): void => {
		if (!drag.current) return;
		drag.current = { ...drag.current, pixels: drag.current.pixels + e.movementX };
		onValueChange(
			scrubValue({ start: drag.current.start, pixels: drag.current.pixels, step, min, max }),
		);
	};
	const end = (): void => {
		if (!drag.current) return;
		drag.current = null;
		if (document.pointerLockElement) document.exitPointerLock();
		onScrubEnd?.();
	};

	return (
		<div
			role="presentation"
			data-slot="number-field"
			className={cn(FIELD_BOX, "tw:cursor-text", className)}
			onClick={focusInput}
		>
			{icon != null && (
				<span
					aria-hidden="true"
					data-slot="number-field-icon"
					className={cn(
						AFFIX,
						"tw:pe-0",
						!disabled && "tw:cursor-ew-resize tw:hover:text-foreground",
					)}
					onPointerDown={begin}
					onPointerMove={move}
					onPointerUp={end}
					onPointerCancel={end}
					/* Inside a PropertyRow `label`, the click that ends a drag would be
					 * forwarded to the input and steal focus mid-gesture. */
					onClick={(e) => e.preventDefault()}
				>
					{icon}
				</span>
			)}
			<input
				ref={input}
				type="number"
				value={value}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				className={INPUT}
				onChange={(e) => {
					if (e.target.value.trim() === "") return;
					const next = Number(e.target.value);
					if (Number.isFinite(next)) onValueChange(next);
				}}
				onFocus={(e) => {
					e.currentTarget.select();
					onFocus?.(e);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					onKeyDown?.(e);
				}}
				{...rest}
			/>
			{suffix && <span className={cn(AFFIX, "tw:ps-0")}>{suffix}</span>}
		</div>
	);
}
