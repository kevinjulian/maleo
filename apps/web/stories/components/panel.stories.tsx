import type { Meta, StoryObj } from "@storybook/react-vite";
import { AmountField, FieldRow } from "@design-system/patterns/inspector.tsx";
import { Panel, Section } from "@design-system/components/panel.tsx";

/* The two panel tiers as they emit today's timeline classes. Their rules live
 * in the timeline sheets (rail.css, media.css), which only load with the
 * editor, so outside it the tiers render as bare structure. The third tier,
 * Control, was replaced by PropertyRow (Patterns/Inspector). */
const meta = {
	title: "Components/Panel",
	component: Panel,
	args: { children: null },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tiers: Story = {
	render: () => (
		<Panel aria-label="Media">
			<Section aria-label="Clip audio">
				<FieldRow label="Volume">
					<AmountField
						label="Volume"
						short="Vol"
						suffix="%"
						min={0}
						max={100}
						value={72}
						onChange={() => {}}
					/>
				</FieldRow>
			</Section>
		</Panel>
	),
};
