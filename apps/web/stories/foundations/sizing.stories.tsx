import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* Sizing and density, separate from spacing because an editor is mostly
 * controls: what height a control is, how big its glyph is, and how wide the
 * panels holding them are. None of these is chosen per screen. */

const HEIGHTS = [
	[
		"xs · editor",
		"--control-h-xs",
		"Property rows, editor fields, small icon buttons. The editor default.",
	],
	["sm · compact", "--control-h-sm", "Toolbars, section headers, compact buttons and selects."],
	["md · form", "--control-h", "Forms and settings pages outside the editor."],
	[
		"touch floor",
		"--control-h-touch",
		"Minimum hit target under a coarse pointer; controls grow to it, not draw at it.",
	],
] as const;

const GEOMETRY = [
	["property row", "--property-row-h", "One PropertyRow.", "height"],
	["section header", "--section-header-h", "One InspectorSection heading.", "height"],
	["top bar height", "--topbar-h", "The sticky app top bar.", "height"],
	["panel width", "--panel-w", "Rail panels and the inspector column.", "width"],
	["sidebar width", "--sidebar-w", "App navigation sidebar.", "width"],
] as const;

const STEPS: (keyof typeof ICON)[] = ["xs", "sm", "md", "lg", "xl", "display"];

const ICON_USE: Record<keyof typeof ICON, string> = {
	xs: "Inside xs controls and chips; reset and disclosure glyphs.",
	sm: "Default in editor rows, menus and sm buttons.",
	md: "Toolbars and md buttons.",
	lg: "Navigation rail and primary nav.",
	xl: "Status and empty-state marks.",
	display: "Page-level empty heroes only.",
};

function Sizing() {
	return (
		<Page
			title="Sizing & Density"
			lead="The editor is dense by default: 24px controls on a 28px row pitch. Larger steps exist for toolbars and for forms outside the editor."
		>
			<Group title="Control heights">
				{HEIGHTS.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<div className="tw:flex tw:items-center tw:gap-3">
							<div
								className="tw:w-28 tw:rounded-md"
								style={{ height: `var(${name})`, background: "var(--surface-strong)" }}
							/>
							{name === "--control-h-xs" && (
								<>
									<div className="tw:w-20">
										<Input size="xs" defaultValue="100" aria-label="xs field" />
									</div>
									<IconButton size="xs" aria-label="Reset">
										{Ic.refresh(ICON.xs)}
									</IconButton>
								</>
							)}
							{name === "--control-h-sm" && (
								<Button variant="secondary" size="sm">
									Compact
								</Button>
							)}
							{name === "--control-h" && <Button variant="primary">Default</Button>}
						</div>
					</RoleRow>
				))}
			</Group>
			<Group
				title="Icon sizes"
				note="Name a step: Ic.check(ICON.sm). check-layers rejects a numeric size outside the registry."
			>
				{STEPS.map((step) => (
					<RoleRow
						key={step}
						role={`${step} · ${ICON[step]}px`}
						name={`ICON.${step}`}
						use={ICON_USE[step]}
					>
						<div className="tw:flex tw:items-center tw:gap-3">
							{Ic.layers(ICON[step])}
							{Ic.settings(ICON[step])}
							{Ic.play(ICON[step])}
						</div>
					</RoleRow>
				))}
			</Group>
			<Group
				title="Editor geometry"
				note="Patterns and panels read these instead of stating their own numbers."
			>
				{GEOMETRY.map(([role, name, use, axis]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<div
							className="tw:max-w-full tw:rounded-md"
							style={
								axis === "height"
									? {
											width: "var(--s-12)",
											height: `var(${name})`,
											background: "var(--surface-strong)",
										}
									: {
											width: `var(${name})`,
											height: "var(--s-3)",
											background: "var(--surface-strong)",
										}
							}
						/>
					</RoleRow>
				))}
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Sizing & Density", component: Sizing } satisfies Meta<
	typeof Sizing
>;
export default meta;
export const Scale: StoryObj<typeof meta> = {};
