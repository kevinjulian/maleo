/* The slider: a native range input with an editor recipe.
 *
 * Native because its keyboard, pointer, form and accessibility contract is
 * exactly what a single-value slider needs; there was no canonical Slider, so
 * every caller got the browser's default — a 16px thumb on a thick track that
 * was the heaviest thing in any inspector row. The appearance lives in
 * slider.css because range pseudo-elements cannot be reached by utilities.
 *
 * The filled part of the track is a custom property, since only Firefox has a
 * pseudo-element for it. Controlled sliders get it from `value`; an
 * uncontrolled one updates it on input. */
import type { InputEvent, InputHTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";
import { cssVars } from "@models/core/css-vars.ts";
import "./slider.css";

export type SliderProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"type" | "min" | "max" | "value" | "defaultValue"
> & {
	min: number;
	max: number;
	value?: number;
	defaultValue?: number;
};

export function sliderFill(value: number, min: number, max: number): string {
	if (max <= min) return "0%";
	const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
	return `${Math.round(pct * 100) / 100}%`;
}

export function Slider({
	min,
	max,
	value,
	defaultValue,
	className,
	style,
	onInput,
	...rest
}: SliderProps): JSX.Element {
	const fill = sliderFill(value ?? defaultValue ?? min, min, max);
	const track = (e: InputEvent<HTMLInputElement>): void => {
		if (value === undefined)
			e.currentTarget.style.setProperty(
				"--ui-slider-fill",
				sliderFill(Number(e.currentTarget.value), min, max),
			);
		onInput?.(e);
	};
	return (
		<input
			type="range"
			data-slot="slider"
			min={min}
			max={max}
			value={value}
			defaultValue={defaultValue}
			className={cn("ui-slider", className)}
			style={{ ...style, ...cssVars({ "--ui-slider-fill": fill }) }}
			onInput={track}
			{...rest}
		/>
	);
}
