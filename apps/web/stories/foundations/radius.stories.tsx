import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "@design-system/components/avatar.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* Four radius roles. A component does not pick a curve; it belongs to a role.
 * Button 6, input 8, card 12, popover 10 and tooltip 5 on one screen is the
 * inconsistency this page exists to prevent. */

const ROLES = [
	["none", "0", "Panels, rows, sections, separators. Flat regions meet edge to edge."],
	["sm", "--r-1", "Controls: buttons, fields, selects, small tiles."],
	["md", "--r-2", "Floating surfaces and dialogs; the rare content tile (media frame)."],
	["full", "--r-pill", "Badges, avatars, pills, switches. Only these."],
] as const;

function Box({ radius }: { radius: string }) {
	return (
		<div
			className="tw:size-14"
			style={{
				borderRadius: radius === "0" ? 0 : `var(${radius})`,
				background: "var(--surface-strong)",
				border: "1px solid var(--border)",
			}}
		/>
	);
}

function Radius() {
	return (
		<Page
			title="Radius"
			lead="Radius scales with the role, not the screen. If a new surface seems to need a fifth curve, it belongs to one of these four."
		>
			<Group title="Roles">
				{ROLES.map(([role, name, use]) => (
					<RoleRow key={role} role={role} name={name === "0" ? "none" : name} use={use}>
						<Box radius={name} />
					</RoleRow>
				))}
			</Group>
			<Group
				title="In use"
				note="sm on every control, md on the floating surface, full on the badge and avatar."
			>
				<div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
					<Button variant="primary" size="sm">
						Export
					</Button>
					<div className="tw:w-20">
						<Input size="xs" defaultValue="100" aria-label="Value" />
					</div>
					<div
						className="tw:px-3 tw:py-2 tw:text-xs"
						style={{
							borderRadius: "var(--r-2)",
							background: "var(--surface-overlay)",
							boxShadow: "var(--shadow-2)",
						}}
					>
						Popover
					</div>
					<Chip tone="ok">Ready</Chip>
					<Avatar name="Kevin Julian" />
				</div>
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Radius", component: Radius } satisfies Meta<typeof Radius>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
