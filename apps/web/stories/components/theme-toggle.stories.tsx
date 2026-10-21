import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "@design-system/components/theme-toggle.tsx";

/* The top bar's quick switch. It writes the app's theme preference, so it
 * flips the same `dark` class as the toolbar Theme control above. */
const meta = {
	title: "Components/ThemeToggle",
	component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
