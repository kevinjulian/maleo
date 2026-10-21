import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@design-system/components/tabs.tsx";

/* Local tabs with roving focus. Addressed destinations are navigation, not
 * tabs (apps/web/DESIGN.md). */
function AuditTabs({ disabledLast = false }: { disabledLast?: boolean }) {
	return (
		<TabsRoot defaultValue="findings">
			<TabsList aria-label="Audit view">
				<TabsTab value="findings">Findings</TabsTab>
				<TabsTab value="evidence">Evidence</TabsTab>
				<TabsTab value="history" disabled={disabledLast}>
					History
				</TabsTab>
			</TabsList>
			<TabsPanel value="findings" className="tw:pt-3 tw:text-sm">
				18 ranked findings.
			</TabsPanel>
			<TabsPanel value="evidence" className="tw:pt-3 tw:text-sm">
				125 captures.
			</TabsPanel>
			<TabsPanel value="history" className="tw:pt-3 tw:text-sm">
				3 runs.
			</TabsPanel>
		</TabsRoot>
	);
}

const meta = {
	title: "Components/Tabs",
	component: AuditTabs,
} satisfies Meta<typeof AuditTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const DisabledTab: Story = { args: { disabledLast: true } };
export const KeyboardNavigation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Findings" }));
		await userEvent.keyboard("{ArrowRight}");
		await expect(canvas.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(canvas.getByRole("tabpanel")).toHaveTextContent("125 captures.");
	},
};

/* A mode switch in chrome: one track, no panels of its own, and arrows that
 * move focus without selecting (Enter or Space selects). */
function ModeSwitch() {
	return (
		<TabsRoot defaultValue="timeline">
			<TabsList variant="segmented" activateOnFocus={false} aria-label="Editor mode">
				{["Storyboard", "Script", "Timeline", "Studio"].map((mode) => (
					<TabsTab key={mode} value={mode.toLowerCase()}>
						{mode}
					</TabsTab>
				))}
			</TabsList>
		</TabsRoot>
	);
}
export const Segmented: Story = {
	render: () => <ModeSwitch />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Timeline" }));
		await userEvent.keyboard("{ArrowRight}");
		await expect(canvas.getByRole("tab", { name: "Studio" })).toHaveFocus();
		await expect(canvas.getByRole("tab", { name: "Timeline" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{Enter}");
		await expect(canvas.getByRole("tab", { name: "Studio" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{Home}");
		await expect(canvas.getByRole("tab", { name: "Storyboard" })).toHaveFocus();
	},
};

export const TabBar: Story = {
	render: () => (
		<TabsRoot defaultValue="all">
			<TabsList variant="bar" aria-label="Element category">
				<TabsTab value="all">All</TabsTab>
				<TabsTab value="shapes">Shapes</TabsTab>
				<TabsTab value="motion" disabled>
					Motion
				</TabsTab>
			</TabsList>
			<TabsPanel value="all">All elements</TabsPanel>
			<TabsPanel value="shapes">Shapes</TabsPanel>
		</TabsRoot>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "All" }));
		await userEvent.keyboard("{ArrowRight}");
		await expect(canvas.getByRole("tab", { name: "Shapes" })).toHaveFocus();
		await expect(canvas.getByRole("tabpanel")).toHaveTextContent("Shapes");
		await userEvent.keyboard("{Home}");
		await expect(canvas.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
	},
};
