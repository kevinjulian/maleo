import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip, Group, Page, Ratio, RoleRow, contrast, over, token } from "./specimen.tsx";

/* Semantic colour roles. Pick the role; write its token. A grey that is not
 * one of these is a defect, not a nuance — especially in dark editor UI, where
 * near-identical greys are how a panel ends up with five backgrounds. */

const SURFACES = [
	["canvas", "--bg", "Behind everything: the app ground between panels."],
	["surface", "--surface", "A panel, inspector, rail or card body."],
	[
		"surface-raised",
		"--surface-raised",
		"An object lifted inside a panel: a focused field, a slider thumb.",
	],
	[
		"surface-overlay",
		"--surface-overlay",
		"Floating surfaces: menus, popovers. Always with an elevation shadow.",
	],
] as const;

const TEXT = [
	["primary", "--fg", "Content and values.", 4.5],
	["secondary", "--fg-dim", "Labels and supporting text that still matters.", 4.5],
	["muted", "--muted", "Hints, metadata, placeholders.", 4.5],
	[
		"disabled",
		"--fg-disabled",
		"Unavailable controls only. Exempt from contrast; never for idle or read-only text.",
		0,
	],
] as const;

const INTERACTION = [
	["hover", "--surface-hover", "Transient pointer feedback; an overlay on whatever is below."],
	["active", "--surface-strong", "Pressed, while the pointer is down."],
	["selected", "--ai-bg", "Persistent selection fill; pair with --ai for the indicator or text."],
	["focus", "--focus-color", "Keyboard focus ring. Never removed to keep a screenshot quiet."],
] as const;

/* Accent and destructive are solid fills (buttons) with a paired foreground.
 * Status tones are never solid fills with text here: they appear as a wash
 * with the tone as text (chips, callouts), so that is the pairing shown. */
const FILLED = [
	["accent", "--ai", "--on-ai", "Selection, focus, checked, primary editor action."],
	["destructive", "--err", "--on-accent", "Delete and error."],
] as const;
const STATUS = [
	["warning", "--warn", "--warn-bg", "Needs attention; not blocking."],
	["success", "--ok", "--ok-bg", "Completed, healthy."],
	["info", "--info", "--info-bg", "Neutral notice."],
] as const;

const BORDERS = [
	["subtle", "--border-subtle", "Quiet separators between groups."],
	["default", "--border", "Control and region boundaries."],
	["strong", "--border-strong", "Emphasis, rarely."],
	["focus", "--border-focus", "A field's focused edge where a ring does not fit."],
] as const;

function Colors() {
	const surface = token("--surface");
	return (
		<Page
			title="Colors"
			lead="Semantic roles, resolved live from tokens.css in the current theme. Ratios are computed against the panel surface; text below 4.5:1 fails."
		>
			<Group
				title="Background"
				note="Four surfaces. Elevation is a role, not a darker grey: raised and overlay are lighter than the panel in both themes."
			>
				<div
					className="tw:rounded-md tw:p-4"
					style={{ background: "var(--bg)", border: "1px solid var(--border-subtle)" }}
				>
					{SURFACES.map(([role, name, use]) => (
						<RoleRow key={name} role={role} name={name} use={use}>
							<Chip
								style={{
									background: `var(${name})`,
									border: "1px solid var(--border-subtle)",
									boxShadow: name === "--surface-overlay" ? "var(--shadow-2)" : undefined,
								}}
							/>
						</RoleRow>
					))}
				</div>
			</Group>
			<Group title="Foreground" note="Three readable tiers and one unavailable state.">
				{TEXT.map(([role, name, use, min]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<Chip style={{ background: "var(--surface)", color: `var(${name})` }}>
							<span className="tw:flex-1">The quick brown fox · 1234</span>
							{min > 0 && <Ratio value={contrast(token(name), surface)} min={min} />}
						</Chip>
					</RoleRow>
				))}
			</Group>
			<Group
				title="Interaction"
				note="States, not colours to decorate with. Each must stay distinguishable while combined with another (selected and hovered, selected and focused)."
			>
				{INTERACTION.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<Chip
							style={
								name === "--focus-color"
									? {
											background: "var(--surface)",
											outline: "var(--focus-w) solid var(--focus-color)",
											outlineOffset: "calc(var(--focus-w) * -1)",
										}
									: {
											background: `color-mix(in srgb, var(--surface), var(--surface)), var(${name})`,
											backgroundColor: "var(--surface)",
											backgroundImage: `linear-gradient(var(${name}), var(${name}))`,
											color: name === "--ai-bg" ? "var(--ai)" : undefined,
										}
							}
						>
							{role}
						</Chip>
					</RoleRow>
				))}
			</Group>
			<Group
				title="Semantic"
				note="Status keeps a name or icon beside the colour; colour alone never carries the meaning."
			>
				{FILLED.map(([role, name, on, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<div className="tw:flex tw:flex-wrap tw:gap-2">
							<Chip style={{ background: `var(${name})`, color: `var(${on})` }}>
								<span className="tw:pe-2">on fill</span>
								<Ratio value={contrast(token(on), token(name))} min={4.5} />
							</Chip>
							<Chip style={{ background: "var(--surface)", color: `var(${name})` }}>
								<span className="tw:pe-2">as text</span>
								<Ratio value={contrast(token(name), surface)} min={4.5} />
							</Chip>
						</div>
					</RoleRow>
				))}
				{STATUS.map(([role, name, wash, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<div className="tw:flex tw:flex-wrap tw:gap-2">
							<Chip
								style={{
									backgroundColor: "var(--surface)",
									backgroundImage: `linear-gradient(var(${wash}), var(${wash}))`,
									color: `var(${name})`,
								}}
							>
								<span className="tw:pe-2">on wash</span>
								<Ratio value={contrast(token(name), over(token(wash), surface))} min={4.5} />
							</Chip>
							<Chip style={{ background: "var(--surface)", color: `var(${name})` }}>
								<span className="tw:pe-2">as text</span>
								<Ratio value={contrast(token(name), surface)} min={4.5} />
							</Chip>
						</div>
					</RoleRow>
				))}
			</Group>
			<Group
				title="Border"
				note="Prefer spacing and type over a border; see Foundations/Borders for when one is warranted."
			>
				{BORDERS.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<Chip style={{ background: "var(--surface)", border: `1px solid var(${name})` }} />
					</RoleRow>
				))}
			</Group>
		</Page>
	);
}

const meta = {
	title: "Foundations/Colors",
	component: Colors,
	parameters: { layout: "padded" },
} satisfies Meta<typeof Colors>;
export default meta;
export const Roles: StoryObj<typeof meta> = {};
