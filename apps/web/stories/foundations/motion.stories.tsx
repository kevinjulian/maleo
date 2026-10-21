import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Group, Page, RoleRow } from "./specimen.tsx";

/* Motion. Two durations and two curves. Motion explains a change of state or
 * place; it never decorates. Timeline keyframes are content, not UI motion,
 * and are not governed here. */

const TOKENS = [
	["fast", "--d-fast", "Hover, press, focus, toggles, chevrons turning."],
	["normal", "--d-med", "Popovers, menus, dialogs and sheets entering or leaving."],
	["standard", "--ease", "State changes in place."],
	["enter", "--ease-out", "Surfaces arriving: decelerate into rest."],
] as const;

const RULES = [
	["Hover / press", "fast", "standard"],
	["Disclosure chevron", "fast", "standard"],
	["Popover / menu", "normal", "enter"],
	["Dialog / sheet", "normal", "enter"],
] as const;

function Demo({ duration, ease, label }: { duration: string; ease: string; label: string }) {
	const [on, setOn] = useState(false);
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	return (
		<div className="tw:flex tw:items-center tw:gap-3">
			<Button variant="secondary" size="sm" onClick={() => setOn(!on)}>
				{label}
			</Button>
			<div
				className="tw:h-2 tw:w-48 tw:overflow-hidden tw:rounded-md"
				style={{ background: "var(--surface-strong)" }}
			>
				<div
					className="tw:size-2 tw:rounded-md"
					style={{
						background: "var(--ai)",
						transform: on ? "translateX(184px)" : "none",
						transition: reduced ? "none" : `transform var(${duration}) var(${ease})`,
					}}
				/>
			</div>
		</div>
	);
}

function Motion() {
	return (
		<Page
			title="Motion"
			lead="Animate transform and opacity only. Reduced-motion users get the end state; nothing essential is carried by movement."
		>
			<Group title="Tokens">
				{TOKENS.map(([role, name, use]) => (
					<RoleRow key={name} role={role} name={name} use={use}>
						<span />
					</RoleRow>
				))}
			</Group>
			<Group title="Rules">
				{RULES.map(([what, d, e]) => (
					<RoleRow
						key={what}
						role={what}
						name={d === "fast" ? "--d-fast" : "--d-med"}
						use={`${d} · ${e}`}
					>
						<Demo
							duration={d === "fast" ? "--d-fast" : "--d-med"}
							ease={e === "enter" ? "--ease-out" : "--ease"}
							label="Play"
						/>
					</RoleRow>
				))}
			</Group>
		</Page>
	);
}

const meta = { title: "Foundations/Motion", component: Motion } satisfies Meta<typeof Motion>;
export default meta;
export const Tokens: StoryObj<typeof meta> = {};
