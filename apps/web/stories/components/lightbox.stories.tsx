import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Lightbox } from "@design-system/components/lightbox.tsx";
import { PORTRAIT_IMAGE } from "./media-fixture.ts";

/* Fullscreen image preview on the overlay stack; scrim, Close or Escape
 * dismiss it. Usually opened from an enlargeable Frame. */
function LightboxHarness({ src, seed, label }: { src?: string; seed?: number; label?: string }) {
	const [open, setOpen] = useState(true);
	return (
		<>
			<Button variant="primary" onClick={() => setOpen(true)}>
				Open preview
			</Button>
			{open && <Lightbox src={src} seed={seed} label={label} onClose={() => setOpen(false)} />}
		</>
	);
}

const meta = {
	title: "Components/Lightbox",
	component: LightboxHarness,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LightboxHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Image: Story = { args: { src: PORTRAIT_IMAGE, label: "Fixture opening" } };
export const Generated: Story = { args: { seed: 7, label: "Generated frame" } };
export const Unlabelled: Story = { args: { src: PORTRAIT_IMAGE } };
