import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Page } from "../foundations/specimen.tsx";

/* What "canonical" means, and which primitives are. The rule set mirrors
 * docs/design-system/principles.md (Canonical components), which owns it. */

const CRITERIA = [
	"Foundation colours: semantic tokens only, no literal paint",
	"Foundation typography: a type role (control text, label, body), never a bare size",
	"Foundation spacing: the spacing scale",
	"Standard control heights: xs 24 / sm 32 / md 40, touch floor under a coarse pointer",
	"Standard radius: sm for controls, md for floating surfaces, full only for pills",
	"Standard borders: the border roles, and none where spacing already separates",
	"Hover, focus, pressed (pointer-down) and disabled states all defined",
	"Variants each name a purpose, not a colour",
	"Storybook demonstrates the variants and states",
	"No arbitrary styling: no legacy class another sheet paints, no one-off values",
];

type Row = { name: string; group: string; purpose: string; status: "Canonical" | "Transitional" };
const ROWS: Row[] = [
	{
		name: "Button",
		group: "Actions",
		purpose: "primary · secondary · ghost · danger; sm / md; `loading`",
		status: "Canonical",
	},
	{
		name: "IconButton",
		group: "Actions",
		purpose: "Text-less action; `on` makes it a toggle; micro / xs / sm / md",
		status: "Canonical",
	},
	{
		name: "Input · Textarea",
		group: "Forms",
		purpose: "Text entry on the shared field recipe; xs (editor) / sm / md",
		status: "Canonical",
	},
	{
		name: "SearchField",
		group: "Forms",
		purpose: "Query with its glyph and one clear control; sm / md",
		status: "Canonical",
	},
	{
		name: "NumberField",
		group: "Forms",
		purpose: "Editor number with scrub prefix and unit",
		status: "Canonical",
	},
	{
		name: "Select",
		group: "Forms",
		purpose: "Native single choice on the field recipe",
		status: "Canonical",
	},
	{
		name: "Checkbox · Switch",
		group: "Forms",
		purpose: "Boolean; checked is the accent",
		status: "Canonical",
	},
	{
		name: "Slider",
		group: "Forms",
		purpose: "Continuous value, native range",
		status: "Canonical",
	},
	{
		name: "Field · FieldLabel",
		group: "Forms",
		purpose: "Label / control / help stack",
		status: "Canonical",
	},
	{
		name: "Tabs",
		group: "Navigation / Selection",
		purpose:
			"Local views with roving focus; outline (in a page) or segmented (a mode switch in chrome)",
		status: "Canonical",
	},
	{
		name: "ToggleGroup · Toggle",
		group: "Navigation / Selection",
		purpose: "Segmented single choice; one on/off flag",
		status: "Canonical",
	},
	{
		name: "Popover",
		group: "Overlays",
		purpose: "Anchored surface for a small task",
		status: "Canonical",
	},
	{
		name: "Menu · ContextMenu",
		group: "Overlays",
		purpose: "Action list from a trigger or the pointer; danger items",
		status: "Canonical",
	},
	{
		name: "Modal (Dialog) · Sheet",
		group: "Overlays",
		purpose: "Task that takes over; lifecycle owned by controllers/overlay",
		status: "Canonical",
	},
	{
		name: "Tooltip",
		group: "Overlays",
		purpose: "Supplemental hint on hover and keyboard focus; never the control's name",
		status: "Canonical",
	},
	{
		name: "Lightbox · Frame",
		group: "Media",
		purpose: "Image viewer on a dark surface; media container with a view badge",
		status: "Canonical",
	},
	{
		name: "AudioPreview",
		group: "Media",
		purpose: "IconButton + Slider + timecode",
		status: "Canonical",
	},
	{
		name: "AlphaColorControl",
		group: "Forms",
		purpose: "Colour + alpha; the picker is the canonical Popover",
		status: "Canonical",
	},
	{
		name: "Chip",
		group: "Feedback",
		purpose: "Badge (tag, toned) and filter pill (inline); ChipButton presses",
		status: "Canonical",
	},
	{
		name: "Note · Callout",
		group: "Feedback",
		purpose: "Advisory line; block-level condition",
		status: "Canonical",
	},
	{
		name: "Spinner · Progress",
		group: "Feedback",
		purpose: "Unmeasured and measured work",
		status: "Canonical",
	},
	{
		name: "Separator",
		group: "Structure",
		purpose: "Subtle rule between groups",
		status: "Canonical",
	},
];

const OMITTED = [
	["ScrollArea", "Only native scroll containers exist; nothing styles a scrollbar."],
];

function Overview() {
	return (
		<Page
			title="Components"
			lead="The primitives the app actually uses, each built only from Foundations. A component is canonical when every criterion below holds; features compose canonical components and never restyle them."
		>
			<Group title="Canonical means">
				<ol className="tw:m-0 tw:flex tw:list-decimal tw:flex-col tw:gap-1 tw:ps-5 tw:text-sm">
					{CRITERIA.map((c) => (
						<li key={c}>{c}</li>
					))}
				</ol>
			</Group>
			<Group title="Status">
				<div className="tw:overflow-x-auto">
					<table className="tw:w-full tw:border-collapse tw:text-sm">
						<thead>
							<tr className="tw:text-left tw:text-[length:var(--type-label-size)] tw:text-[var(--fg-dim)]">
								{["Component", "Group", "Purpose", "Status"].map((h) => (
									<th key={h} className="tw:py-2 tw:pe-4 tw:font-medium">
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{ROWS.map((r) => (
								<tr key={r.name} style={{ borderTop: "1px solid var(--border-subtle)" }}>
									<td className="tw:py-2 tw:pe-4 tw:font-medium">{r.name}</td>
									<td className="tw:py-2 tw:pe-4 tw:text-muted-foreground">{r.group}</td>
									<td className="tw:py-2 tw:pe-4">{r.purpose}</td>
									<td
										className="tw:py-2"
										style={{ color: r.status === "Canonical" ? "var(--ok)" : "var(--warn)" }}
									>
										{r.status}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Group>
			<Group title="Deliberately not built">
				<ul className="tw:m-0 tw:flex tw:list-disc tw:flex-col tw:gap-1 tw:ps-5 tw:text-sm">
					{OMITTED.map(([n, why]) => (
						<li key={n}>
							<strong className="tw:font-semibold">{n}</strong> — {why}
						</li>
					))}
				</ul>
			</Group>
		</Page>
	);
}

const meta = { title: "Components/Overview", component: Overview } satisfies Meta<typeof Overview>;
export default meta;
export const Status: StoryObj<typeof meta> = {};
