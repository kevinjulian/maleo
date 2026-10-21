import type { Meta, StoryObj } from "@storybook/react-vite";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* The spacing scale. Six steps for everyday rhythm; three more that exist
 * only for page layout. A gap that is not a step here is chosen by eye, and
 * an eye-chosen gap is the one that drifts. */

const SCALE = [
	["xs", "--s-1", "Icon to text; controls inside one row; rows in a dense list."],
	["sm", "--s-2", "Label to control; related control groups."],
	["md", "--s-3", "Panel inline padding; space under a section's last row."],
	["lg", "--s-4", "Panel padding in non-dense surfaces; related groups."],
	["xl", "--s-6", "Between sections of a page."],
	["2xl", "--s-8", "Page gutters; major regions."],
] as const;

const LAYOUT = [
	["layout-20", "--s-5", "Legacy layout spacing; not for new components."],
	["layout-48", "--s-12", "Page-level breathing room."],
	["layout-80", "--s-16", "Hero and onboarding only."],
] as const;

function Bar({ name }: { name: string }) {
	return (
		<div
			className="tw:h-4 tw:rounded-md"
			style={{ width: `var(${name})`, background: "var(--ai)" }}
		/>
	);
}

function Spacing() {
	return (
		<Page
			title="Spacing"
			lead="Pick a step by what it separates. Zero, auto and content-derived geometry (timeline coordinates, aspect ratios) are not spacing and stay outside the scale."
		>
			<Group title="Scale">
				{SCALE.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<Bar name={name} />
					</RoleRow>
				))}
			</Group>
			<Group
				title="Layout exceptions"
				note="Named, not general. A component does not reach for these."
			>
				{LAYOUT.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<Bar name={name} />
					</RoleRow>
				))}
			</Group>
			<Group
				title="Rhythm in use"
				note="An inspector section: md inline padding, xs between 24px rows (28px pitch), sm from label to control, xs between paired fields."
			>
				<div
					className="tw:w-[332px]"
					style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)" }}
				>
					<InspectorSection title="Position & Size">
						<PropertyRow label="Position" as="div">
							<NumberField
								icon="X"
								suffix="%"
								aria-label="X offset"
								value={12}
								onValueChange={() => {}}
							/>
							<NumberField
								icon="Y"
								suffix="%"
								aria-label="Y offset"
								value={-4}
								onValueChange={() => {}}
							/>
						</PropertyRow>
						<PropertyRow label="Size" as="div">
							<NumberField
								icon="W"
								suffix="%"
								aria-label="Width"
								value={80}
								onValueChange={() => {}}
							/>
							<NumberField
								icon="H"
								suffix="%"
								aria-label="Height"
								value={100}
								onValueChange={() => {}}
							/>
						</PropertyRow>
					</InspectorSection>
				</div>
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Spacing", component: Spacing } satisfies Meta<typeof Spacing>;
export default meta;
export const Scale: StoryObj<typeof meta> = {};
