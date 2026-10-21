import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { PORTRAIT_IMAGE, SQUARE_IMAGE } from "./media-fixture.ts";

const meta = {
	title: "Components/Frame",
	component: Frame,
	args: { w: 180 },
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = { args: { icon: Ic.image(ICON.lg), label: "start frame" } };
export const Generated: Story = { args: { generated: true, seed: 7 } };
export const Image: Story = { args: { src: PORTRAIT_IMAGE, label: "Fixture opening" } };
export const Contain: Story = { args: { src: SQUARE_IMAGE, fit: "contain", label: "Logo" } };
export const Square: Story = { args: { src: SQUARE_IMAGE, aspect: 1, label: "Avatar reference" } };
/* The badge becomes a "View larger" control that opens the Lightbox. */
export const Enlargeable: Story = {
	args: { src: PORTRAIT_IMAGE, label: "Fixture opening", enlargeable: true },
};
export const Generating: Story = { args: { generated: true, seed: 3, children: <Shimmer /> } };
