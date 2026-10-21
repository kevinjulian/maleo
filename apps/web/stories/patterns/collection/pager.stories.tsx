import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pager } from "@design-system/patterns/collection.tsx";

/* Previous/next under a server-paged collection. Hidden when everything fits. */
const noop = (): void => {};
const meta = {
	title: "Patterns/Pager",
	component: Pager,
	args: {
		label: "Project pages",
		range: { start: 1, end: 20, total: 24 },
		page: { current: 1, count: 2 },
		hasPrevious: false,
		hasNext: true,
		onPrevious: noop,
		onNext: noop,
	},
} satisfies Meta<typeof Pager>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstPage: Story = {};
export const LastPage: Story = {
	args: {
		range: { start: 21, end: 24, total: 24 },
		page: { current: 2, count: 2 },
		hasPrevious: true,
		hasNext: false,
	},
};
export const RangeOnly: Story = {
	args: { label: "Export pages", range: { start: 1, end: 60, total: 66 }, page: undefined },
};
export const Loading: Story = { args: { hasPrevious: true, busy: true } };
