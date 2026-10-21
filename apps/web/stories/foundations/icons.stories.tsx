import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Ic } from "@design-system/icons/index.tsx";
import { Input } from "@design-system/components/input.tsx";

/* The one icon registry, read live: a glyph added to design-system/icons appears
 * here with no story change. Every glyph is `Ic.name(size)` and inherits
 * `currentColor`, so the tones row shows them on the token colours rather than
 * in a colour of their own. */
const NAMES = Object.keys(Ic).sort();
const TONES = ["--fg", "--muted", "--ai", "--ok", "--warn", "--err"] as const;

function IconGallery({ size, tone }: { size: number; tone: (typeof TONES)[number] }) {
	const [query, setQuery] = useState("");
	const shown = NAMES.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
	return (
		<div className="tw:flex tw:flex-col tw:gap-4">
			<div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
				<Input
					type="search"
					aria-label="Filter icons"
					placeholder="Filter icons"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="tw:max-w-60"
				/>
				<span className="tw:text-xs tw:text-muted-foreground" role="status">
					{shown.length} of {NAMES.length}
				</span>
			</div>
			<ul
				className="tw:m-0 tw:grid tw:list-none tw:grid-cols-[repeat(auto-fill,minmax(96px,1fr))] tw:gap-2 tw:p-0"
				style={{ color: `var(${tone})` }}
			>
				{shown.map((name) => (
					<li
						key={name}
						className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border tw:px-2 tw:py-3"
					>
						{Ic[name]!(size)}
						<code className="tw:max-w-full tw:truncate tw:text-xs tw:text-muted-foreground">
							{name}
						</code>
					</li>
				))}
			</ul>
			{shown.length === 0 && (
				<p className="tw:m-0 tw:text-sm tw:text-muted-foreground">No icon matches “{query}”.</p>
			)}
		</div>
	);
}

const meta = {
	title: "Foundations/Icons",
	component: IconGallery,
	args: { size: 16, tone: "--fg" },
	argTypes: {
		size: { control: "inline-radio", options: [12, 14, 16, 20, 24] },
		tone: { control: "inline-radio", options: TONES },
	},
} satisfies Meta<typeof IconGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
/* The sizes call sites actually pass: 12-14 in dense editor chrome, 16 by
 * default, 24 at most. */
export const Small: Story = { args: { size: 12 } };
export const Large: Story = { args: { size: 24 } };
export const OnAccent: Story = { args: { tone: "--ai" } };
export const Filter: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole("searchbox", { name: "Filter icons" }), "chev");
		await expect(canvas.getByText("chevD")).toBeVisible();
		await expect(canvas.queryByText("trash")).toBeNull();
	},
};
