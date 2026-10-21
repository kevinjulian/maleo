import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { clipCompositingBlockers, type ClipLayout } from "@maleo/shared";
import { ClipCompositingFields } from "../../../src/components/timeline/clip-compositing-control.tsx";
import { InspectorFrame } from "./inspector-frame.tsx";

function Fixture({ disabled = false }: { disabled?: boolean }) {
	const [layout, setLayout] = useState<Partial<ClipLayout>>({});
	const [error, setError] = useState<string | null>(null);
	return (
		<InspectorFrame width="narrow">
			<ClipCompositingFields
				layout={layout}
				disabled={disabled}
				error={error}
				onChange={(patch) => {
					const issues = clipCompositingBlockers({ layout: patch });
					if (issues.length) setError(issues.join(" "));
					else {
						setLayout({ ...layout, ...patch });
						setError(null);
					}
				}}
			/>
		</InspectorFrame>
	);
}
const meta = { title: "Features/Timeline/ClipCompositing", component: Fixture } satisfies Meta<
	typeof Fixture
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Controls: Story = {};
export const Locked: Story = { args: { disabled: true } };
