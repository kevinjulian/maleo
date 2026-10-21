import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Input } from "@design-system/components/input.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { DoDont, Group, Page } from "./specimen.tsx";

/* The north star for every other page, and the first thing an agent should
 * read before building UI. The Do examples are the real patterns; the Don't
 * examples are drawn by hand on purpose, to show what the patterns replace. */

const QUALITIES = ["Dense", "Professional", "Quiet", "Precise", "Content-first", "Low decoration"];

const PRINCIPLES = [
	[
		"Content has priority over application chrome.",
		"The canvas, the clip and the value are the subject; panels, toolbars and headers recede.",
	],
	[
		"Prefer spacing and typography over containers.",
		"Group with a heading and a gap before reaching for a border, a background or a card.",
	],
	[
		"Avoid unnecessary borders and backgrounds.",
		"Every boundary must separate something the eye could not otherwise tell apart.",
	],
	[
		"Controls are compact.",
		"People adjust many properties, often. The editor default is a 24px control on a 28px row.",
	],
	[
		"Similar interactions look and behave identically.",
		"One PropertyRow, one editor field, one reset placement, everywhere a property is edited.",
	],
	[
		"Elevation represents hierarchy, not decoration.",
		"Only floating surfaces cast shadows; panels sit flat.",
	],
	[
		"Use semantic tokens. Never introduce arbitrary values.",
		"Pick a role — surface-raised, label, sm radius — and write its token. 31px because it looked right is a defect.",
	],
	[
		"Prefer composition over specialized components.",
		"PropertyRow plus NumberField, not an OpacityProperty. Patterns arrange; controls stay generic.",
	],
];

function Overview() {
	return (
		<Page
			title="Maleo design language"
			lead="Maleo is a creative editor, not a dashboard. Its interface is a precise instrument around the user's content."
		>
			<Group title="Qualities">
				<div className="tw:flex tw:flex-wrap tw:gap-2">
					{QUALITIES.map((q) => (
						<span
							key={q}
							className="tw:rounded-md tw:px-2.5 tw:py-1 tw:text-xs tw:font-medium"
							style={{ background: "var(--surface-strong)" }}
						>
							{q}
						</span>
					))}
				</div>
			</Group>
			<Group title="Principles">
				<ol className="tw:m-0 tw:flex tw:list-decimal tw:flex-col tw:gap-3 tw:ps-5">
					{PRINCIPLES.map(([rule, why]) => (
						<li key={rule} className="tw:text-sm">
							<strong className="tw:font-semibold">{rule}</strong>
							<br />
							<span className="tw:text-xs tw:text-muted-foreground">{why}</span>
						</li>
					))}
				</ol>
			</Group>
			<Group title="Property editing">
				<DoDont
					good={
						<div className="tw:w-[300px]" style={{ background: "var(--surface)" }}>
							<InspectorSection title="Transform">
								<PropertyRow label="Position" as="div">
									<NumberField icon="X" aria-label="X" value={12} onValueChange={() => {}} />
									<NumberField icon="Y" aria-label="Y" value={-4} onValueChange={() => {}} />
								</PropertyRow>
								<PropertyRow label="Rotation">
									<NumberField
										icon={Ic.regen(ICON.xs)}
										suffix="°"
										value={0}
										onValueChange={() => {}}
									/>
								</PropertyRow>
							</InspectorSection>
						</div>
					}
					goodNote="Label and value on one line, aligned to one column; a heading groups them."
					bad={
						<div className="tw:flex tw:w-[300px] tw:flex-col tw:gap-3">
							{["Position", "Rotation"].map((l) => (
								<div
									key={l}
									className="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:p-4"
									style={{
										border: "1px solid var(--border-strong)",
										borderRadius: "var(--r-2)",
										boxShadow: "var(--shadow-2)",
									}}
								>
									<span className="tw:text-sm tw:font-semibold">{l}</span>
									<Input defaultValue="0" aria-label={l} />
								</div>
							))}
						</div>
					}
					badNote="A shadowed card per property, centred, with a 40px form field: a web form, and half as many properties on screen."
				/>
			</Group>
			<Group title="Actions">
				<DoDont
					good={
						<div className="tw:flex tw:items-center tw:gap-1">
							{[Ic.undo, Ic.redo, Ic.cut, Ic.copy].map((g, i) => (
								<IconButton key={i} size="xs" aria-label={["Undo", "Redo", "Split", "Copy"][i]!}>
									{g!(ICON.md)}
								</IconButton>
							))}
						</div>
					}
					goodNote="Quiet icon buttons that share one size; the accent is kept for state."
					bad={
						<div className="tw:flex tw:items-center tw:gap-2">
							{["Undo", "Redo", "Split", "Copy"].map((l, i) => (
								<button
									key={l}
									type="button"
									className="tw:rounded-md tw:px-4 tw:py-2 tw:text-sm tw:font-semibold"
									style={{
										background: ["var(--ai)", "var(--ok)", "var(--warn)", "var(--err)"][i],
										color: "var(--on-accent)",
									}}
								>
									{l}
								</button>
							))}
						</div>
					}
					badNote="Colour as decoration: every action shouts, so none can signal state."
				/>
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Overview", component: Overview } satisfies Meta<typeof Overview>;
export default meta;
export const DesignLanguage: StoryObj<typeof meta> = {};
