import type { Meta, StoryObj } from "@storybook/react-vite";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Input } from "@design-system/components/input.tsx";
import { DoDont, Group, Page, RoleRow } from "./specimen.tsx";

/* Borders. The question is not which border but whether one is needed:
 * spacing, type and surface hierarchy group things first. A border is for a
 * boundary the eye cannot otherwise find. */

const ROLES = [
	["subtle", "--border-subtle", "Separators between groups in a panel: InspectorSection rules."],
	["default", "--border", "A region's edge against a different surface; an outlined control."],
	["strong", "--border-strong", "Rare emphasis; a dashed drop target."],
	[
		"focus",
		"--border-focus",
		"A field's edge while focused where a ring cannot fit. The ring (--focus-color) is the default focus indicator.",
	],
] as const;

function Borders() {
	return (
		<Page
			title="Borders"
			lead="Don't use borders to solve every grouping problem. Prefer spacing, typography and surface hierarchy first; boxes inside boxes is the generic-dashboard look this system rejects."
		>
			<Group title="Roles">
				{ROLES.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<div
							className="tw:h-10 tw:rounded-md"
							style={{ background: "var(--surface)", border: `1px solid var(${name})` }}
						/>
					</RoleRow>
				))}
			</Group>
			<Group title="When to use a border">
				<ul className="tw:m-0 tw:flex tw:list-disc tw:flex-col tw:gap-1 tw:ps-5 tw:text-sm">
					<li>
						Between two regions with the same surface paint, where nothing else separates them
						(subtle).
					</li>
					<li>
						Where a panel meets the canvas and the paints are too close to tell apart (default).
					</li>
					<li>An error or focus state that must be visible regardless of fill.</li>
				</ul>
			</Group>
			<Group title="When not to">
				<ul className="tw:m-0 tw:flex tw:list-disc tw:flex-col tw:gap-1 tw:ps-5 tw:text-sm">
					<li>
						Around each property, row or field in a panel: filled editor fields need no outline at
						rest.
					</li>
					<li>Around a group that already has a heading and spacing.</li>
					<li>A card inside a panel inside a card. One surface change is enough.</li>
				</ul>
			</Group>
			<Group title="Grouping">
				<DoDont
					good={
						<div className="tw:w-[300px]" style={{ background: "var(--surface)" }}>
							<InspectorSection title="Data">
								<PropertyRow label="Title">
									<Input size="xs" defaultValue="Fixture measure" />
								</PropertyRow>
								<PropertyRow label="Value">
									<Input size="xs" defaultValue="42" />
								</PropertyRow>
							</InspectorSection>
						</div>
					}
					goodNote="A heading and spacing group the rows; one subtle rule ends the section."
					bad={
						<div
							className="tw:flex tw:w-[300px] tw:flex-col tw:gap-2 tw:p-3"
							style={{
								background: "var(--surface)",
								border: "1px solid var(--border-strong)",
								borderRadius: "var(--r-2)",
							}}
						>
							{["Title", "Value"].map((l) => (
								<div
									key={l}
									className="tw:flex tw:flex-col tw:gap-2 tw:p-3"
									style={{ border: "1px solid var(--border-strong)", borderRadius: "var(--r-2)" }}
								>
									<span className="tw:text-xs">{l}</span>
									<Input defaultValue={l === "Title" ? "Fixture measure" : "42"} aria-label={l} />
								</div>
							))}
						</div>
					}
					badNote="A card per property inside a bordered panel: three nested boundaries saying the same thing."
				/>
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Borders", component: Borders } satisfies Meta<typeof Borders>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
