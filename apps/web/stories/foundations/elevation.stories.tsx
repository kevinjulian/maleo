import type { Meta, StoryObj } from "@storybook/react-vite";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* Elevation. A shadow says "this floats above its context", so it is earned by
 * floating. Panels, inspectors and the timeline sit flat on the canvas; a
 * shadow on them is decoration and flattens the real hierarchy. */

const ROLES = [
	[
		"none",
		"",
		"Panels, inspector, timeline, cards in a grid. Separated by surface and a subtle rule.",
	],
	["floating", "--shadow-1", "Small lifted objects: slider thumb, a dragged clip, a tooltip."],
	["overlay", "--shadow-2", "Anchored floating surfaces: menus, popovers, the colour picker."],
	["modal", "--shadow-3", "Dialogs and sheets that take over the screen, with a scrim."],
] as const;

function Elevation() {
	return (
		<Page
			title="Shadows & Elevation"
			lead="Surface elevation represents actual hierarchy, not decoration. Floating surfaces pair a shadow with --surface-overlay and the md radius."
		>
			<Group title="Roles">
				<div className="tw:rounded-md tw:p-6" style={{ background: "var(--bg)" }}>
					{ROLES.map(([role, name, use]) => (
						<RoleRow key={role} role={role} name={name || "none"} use={use}>
							<div
								className="tw:h-14 tw:w-40"
								style={{
									borderRadius: name ? "var(--r-2)" : 0,
									background: name ? "var(--surface-overlay)" : "var(--surface)",
									boxShadow: name ? `var(${name})` : undefined,
									border: name ? undefined : "1px solid var(--border-subtle)",
								}}
							/>
						</RoleRow>
					))}
				</div>
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Shadows & Elevation", component: Elevation } satisfies Meta<
	typeof Elevation
>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
