/* Colour + alpha control, read by the editor and the timeline — two clusters, so
 * it is a ui primitive rather than any one cluster's.
 * Its `alpha-color-*` rules live beside it in color-control.css; the timeline
 * keeps only its in-panel width override.
 *
 * The picker is the canonical Popover, so placement, outside press, Escape and
 * focus return are Base UI's. It used to position itself by measuring a
 * timeline panel and could only be closed with its own Done button. */
import { useState } from "react";
import type { JSX } from "react";
import { cn } from "@models/core/cn.ts";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import "./color-control.css";

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;

function normalizeAlphaHex(value: string | undefined, fallback: string): string {
	const raw = (value || "").trim();
	if (raw === "transparent") return "#00000000";
	if (HEX8.test(raw)) return raw.toLowerCase();
	if (HEX6.test(raw)) return `${raw.toLowerCase()}ff`;
	if (HEX8.test(fallback)) return fallback.toLowerCase();
	if (HEX6.test(fallback)) return `${fallback.toLowerCase()}ff`;
	return "#000000ff";
}

function previewBackground(value: string): string {
	return value === "transparent" ? "transparent" : normalizeAlphaHex(value, "#000000");
}

export function AlphaColorControl({
	label,
	value,
	fallback,
	onChange,
	compact,
	display: shown = "label",
	brandValue,
	brandLabel,
}: {
	label: string;
	value: string | undefined;
	fallback: string;
	onChange: (next: string) => void;
	compact?: boolean;
	/** What the trigger says. `label` (default) names the property, for a
	 *  control standing alone. `value` shows the colour itself, for a control
	 *  inside a PropertyRow whose label already names it; the trigger is then
	 *  the editor field and its accessible name is still "<label> color". */
	display?: "label" | "value";
	brandValue?: string;
	brandLabel?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const color = normalizeAlphaHex(value, fallback);
	const display = value && value !== "transparent" ? value : color;
	const setColor = (next: string): void => onChange(normalizeAlphaHex(next, fallback));
	return (
		<div
			className={cn("alpha-color", compact && "compact")}
			data-slot="color-control"
			data-display={shown}
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button type="button" className="alpha-color-trigger" aria-label={`${label} color`}>
						{shown === "label" && <span>{label}</span>}
						<i
							className={value === "transparent" ? "none" : ""}
							style={{ background: previewBackground(value || color) }}
						/>
						{shown === "value" && (
							<span>{value === "transparent" ? "Transparent" : display.toUpperCase()}</span>
						)}
					</button>
				</PopoverTrigger>
				<PopoverContent align="end" className="alpha-color-pop">
					<HexAlphaColorPicker color={color} onChange={setColor} />
					<div className="alpha-color-row">
						<span>#</span>
						<HexColorInput
							aria-label={`${label} hex`}
							color={display.replace(/^#/, "")}
							/* Reports `#…` whatever `prefixed` says (that prop only formats the field), and reports 3- and 4-digit shorthand on the way to a full value; committing those reset the colour to the fallback mid-typing. */ onChange={(
								next,
							) => {
								if (HEX6.test(next) || HEX8.test(next)) setColor(next);
							}}
							alpha
							prefixed={false}
						/>
					</div>
					<div className="alpha-color-actions">
						{brandValue ? (
							<button type="button" onClick={() => onChange(brandValue)}>
								{brandLabel ?? "Brand"}
							</button>
						) : null}
						<button type="button" onClick={() => onChange("transparent")}>
							Transparent
						</button>
						<button type="button" onClick={() => setOpen(false)}>
							Done
						</button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
