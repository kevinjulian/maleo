import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* Text roles. Choose by purpose — "this is a property label" — and the role
 * brings size, line height, weight, tracking and colour together. Never set a
 * font-size on its own; a size without its role is how 11.5px and 12.5px crept
 * in. Display and page title belong to pages and onboarding, not editor chrome. */

type Role = { role: string; token: string; use: string; sample: string; style: CSSProperties };

const ROLES: Role[] = [
	{
		role: "Display",
		token: "--type-display-size",
		use: "Onboarding and empty-product moments. Never in editor chrome.",
		sample: "Make a video",
		style: {
			fontFamily: "var(--font-display)",
			fontSize: "var(--type-display-size)",
			lineHeight: "var(--type-display-lh)",
			letterSpacing: "var(--type-display-track)",
			fontWeight: "var(--weight-display)",
		},
	},
	{
		role: "Page title",
		token: "--type-title-size",
		use: "The heading of a page outside the editor.",
		sample: "Presets",
		style: {
			fontFamily: "var(--font-display)",
			fontSize: "var(--type-title-size)",
			lineHeight: "var(--type-title-lh)",
			letterSpacing: "var(--type-title-track)",
			fontWeight: "var(--weight-display)",
		},
	},
	{
		role: "Heading",
		token: "--type-section-size",
		use: "A section heading within a page.",
		sample: "Workspace members",
		style: {
			fontSize: "var(--type-section-size)",
			lineHeight: "var(--type-section-lh)",
			letterSpacing: "var(--type-section-track)",
			fontWeight: "var(--weight-strong)",
		},
	},
	{
		role: "Panel title",
		token: "--type-subsection-size",
		use: "The title of a panel, sheet or dialog.",
		sample: "Clip properties",
		style: {
			fontSize: "var(--type-subsection-size)",
			lineHeight: "var(--type-subsection-lh)",
			letterSpacing: "var(--type-subsection-track)",
			fontWeight: "var(--weight-strong)",
		},
	},
	{
		role: "Section title",
		token: "--type-caption-size",
		use: "A group heading inside a panel: InspectorSection.",
		sample: "Position & Size",
		style: {
			fontSize: "var(--type-caption-size)",
			lineHeight: "var(--type-caption-lh)",
			fontWeight: "var(--weight-strong)",
		},
	},
	{
		role: "Body",
		token: "--type-body-size",
		use: "Default reading text and form controls.",
		sample: "A fixture hook establishes the question before the first cut.",
		style: {
			fontSize: "var(--type-body-size)",
			lineHeight: "var(--type-body-lh)",
			fontWeight: "var(--weight-body)",
		},
	},
	{
		role: "Control text",
		token: "--type-control-size",
		use: "The value inside a field, select, tab or chip (the text-xs utility).",
		sample: "cover · 100 %",
		style: {
			fontSize: "var(--type-control-size)",
			lineHeight: 1.33,
			fontVariantNumeric: "tabular-nums",
		},
	},
	{
		role: "Label",
		token: "--type-label-size",
		use: "A property or field label beside or above its control, in --fg-dim.",
		sample: "Opacity",
		style: {
			fontSize: "var(--type-label-size)",
			lineHeight: "var(--type-label-lh)",
			color: "var(--fg-dim)",
		},
	},
	{
		role: "Caption",
		token: "--type-caption-size",
		use: "Supporting prose under something.",
		sample: "Applies to every section using this template.",
		style: {
			fontSize: "var(--type-caption-size)",
			lineHeight: "var(--type-caption-lh)",
			color: "var(--fg-dim)",
		},
	},
	{
		role: "Muted",
		token: "--muted",
		use: "Hints and metadata: the caption recipe in --muted.",
		sample: "Edited 2 minutes ago",
		style: {
			fontSize: "var(--type-caption-size)",
			lineHeight: "var(--type-caption-lh)",
			color: "var(--muted)",
		},
	},
	{
		role: "Code / numeric",
		token: "--type-data-size",
		use: "Timecode, measurements, IDs. Interface type with tabular figures, never a monospace.",
		sample: "00:04:12.08 · 1920×1080",
		style: {
			fontSize: "var(--type-data-size)",
			lineHeight: "var(--type-data-lh)",
			fontVariantNumeric: "tabular-nums",
		},
	},
];

function Typography() {
	return (
		<Page
			title="Typography"
			lead="One family, Space Grotesk, for everything. There is no monospace and no uppercase micro label: hierarchy comes from size, weight and colour, and digits align by tabular figures. Pick a role; the role carries the whole recipe."
		>
			<Group
				title="Roles"
				note="Hierarchy inside the editor comes from three of these in a row: section title (12 strong) → label (11, dim) → control text (12, tabular)."
			>
				{ROLES.map((r) => (
					<RoleRow key={r.role} role={r.role} name={r.token} use={r.use}>
						<div className="tw:min-w-0 tw:truncate" style={r.style}>
							{r.sample}
						</div>
					</RoleRow>
				))}
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Typography", component: Typography } satisfies Meta<
	typeof Typography
>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
