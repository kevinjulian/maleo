/* The Inspector patterns: InspectorSection and PropertyRow.
 *
 * Specified in docs/design-system/patterns/inspector-section.md and
 * property-row.md. Both are compositions: they own hierarchy, alignment,
 * density and disclosure, and nothing else. Values, edits, selection and
 * persistence come from the feature as children and callbacks, so neither
 * pattern knows what a clip, a layout or a volume is.
 *
 * They sit beside Panel / Section / Control (panel.tsx) rather than replacing
 * them. Those emit the timeline's existing classes and move no pixels; these
 * are the reviewed target the inspectors migrate onto, one section at a time.
 *
 * InspectorSection does not wrap the package's AccordionSection. That
 * component renders its header tools inside the toggle button, so a section
 * action would be a button inside a button, and the spec asks for an action
 * beside the disclosure. The disclosure here is the WAI-ARIA one: a heading
 * containing a button with `aria-expanded` and `aria-controls`.
 */
import { useId, useState } from "react";
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import "./inspector.css";

export type InspectorSectionProps = {
	title: string;
	/** Render the heading as a disclosure button. Static sections stay open. */
	collapsible?: boolean;
	/** Initial state of a collapsible section; ignored when not collapsible. */
	defaultOpen?: boolean;
	/** One section-scoped action, placed beside the heading — never inside it. */
	action?: ReactNode;
	/** Current value, shown beside the title only while collapsed. */
	summary?: ReactNode;
	children: ReactNode;
};

export function InspectorSection({
	title,
	collapsible = false,
	defaultOpen = false,
	action,
	summary,
	children,
}: InspectorSectionProps): JSX.Element {
	const [open, setOpen] = useState(!collapsible || defaultOpen);
	const headingId = useId();
	const bodyId = useId();
	return (
		<section className="ui-insp-section" aria-labelledby={headingId} data-slot="inspector-section">
			<div className="ui-insp-head">
				<h3 id={headingId} aria-label={title} className="ui-insp-title">
					{collapsible ? (
						<button
							type="button"
							className="ui-insp-toggle"
							aria-expanded={open}
							aria-controls={bodyId}
							onClick={() => setOpen(!open)}
						>
							<span className="ui-insp-title-text">{title}</span>
							{!open && summary != null && <span className="ui-insp-summary">{summary}</span>}
							<span className="ui-insp-chev" aria-hidden="true">
								{Ic.chevD(ICON.xs)}
							</span>
						</button>
					) : (
						<span className="ui-insp-title-text">{title}</span>
					)}
				</h3>
				{action && <div className="ui-insp-action">{action}</div>}
			</div>
			<div id={bodyId} className="ui-insp-body" hidden={!open}>
				{children}
			</div>
		</section>
	);
}

export type PropertyRowProps = {
	label: string;
	/** `label` wraps a single control so the row's label names it. `div` is for
	 *  compound controls (X and Y, slider and number): the row becomes a named
	 *  group and each control keeps its own `aria-label`. */
	as?: "label" | "div";
	/** Shown on hover, focus-within and always on touch; named "Reset <label>". */
	onReset?: () => void;
	/** Adjacent value actions; compound fields keep their own accessible names. */
	actions?: ReactNode;
	/** A control that precedes the label, such as a keyframe toggle. */
	beforeLabel?: ReactNode;
	children: ReactNode;
};

export function PropertyRow({
	label,
	as = "label",
	onReset,
	actions,
	beforeLabel,
	children,
}: PropertyRowProps): JSX.Element {
	const labelId = useId();
	const labelText = (
		<span id={labelId} className="ui-insp-label">
			{label}
		</span>
	);
	const content = (
		<>
			{beforeLabel ? (
				<span className="ui-insp-labelline">
					{beforeLabel}
					{labelText}
				</span>
			) : (
				labelText
			)}
			<span className="ui-insp-value">
				<span className="ui-insp-control">{children}</span>
				{actions && (
					<span className="ui-insp-actions" data-slot="property-row-actions">
						{actions}
					</span>
				)}
			</span>
		</>
	);
	return (
		<div className="ui-insp-row" data-slot="property-row">
			{as === "label" && !actions && !beforeLabel ? (
				<label className="ui-insp-main">{content}</label>
			) : (
				<div className="ui-insp-main" role="group" aria-labelledby={labelId}>
					{content}
				</div>
			)}
			<span className="ui-insp-reset" data-slot="property-row-reset">
				{onReset && (
					<IconButton
						size="xs"
						aria-label={`Reset ${label}`}
						title={`Reset ${label}`}
						onClick={onReset}
					>
						{Ic.refresh(ICON.xs)}
					</IconButton>
				)}
			</span>
		</div>
	);
}

export type FieldRowProps = Omit<PropertyRowProps, "as">;

/* Values edited together share one row: Position is X and Y, Size is width,
 * lock and height. The row is a named group; each cell keeps its own name.
 * Number cells share the line and wrap when the inspector is too narrow for
 * all of them; icon cells (a lock, a flip) keep their width beside them. */
export function FieldRow({ children, ...row }: FieldRowProps): JSX.Element {
	return (
		<PropertyRow {...row} as="div">
			<span className="ui-insp-cells" data-slot="field-row">
				{children}
			</span>
		</PropertyRow>
	);
}

export type AmountFieldProps = {
	/** The property, as the field's accessible name: "X offset", "Opacity". */
	label: string;
	/** The short label inside the field, dragged to scrub: "X", "W", "°". */
	short: ReactNode;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	/** The unit after the value: "%", "px", "s". */
	suffix?: string;
	onChange: (value: number) => void;
	onScrubEnd?: () => void;
	disabled?: boolean;
};

/** One amount in a FieldRow: a scrubbable number shown at its step's precision. */
export function AmountField({
	label,
	short,
	value,
	min,
	max,
	step = 1,
	suffix,
	onChange,
	onScrubEnd,
	disabled,
}: AmountFieldProps): JSX.Element {
	/* Shown at the step's precision: a stored 0.30000000000000004 is 0.3. */
	const decimals = (String(step).split(".")[1] ?? "").length;
	return (
		<NumberField
			aria-label={label}
			icon={short}
			suffix={suffix}
			min={min}
			max={max}
			step={step}
			value={Number(value.toFixed(decimals))}
			disabled={disabled}
			onValueChange={onChange}
			onScrubEnd={onScrubEnd}
		/>
	);
}
