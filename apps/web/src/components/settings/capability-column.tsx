import { SelectionRow } from "@design-system/components/selection-row.tsx";
/* Column 1 of the Capabilities tab: what this app can be set up to do.
 *
 * A capability is the operator's unit of thought — "can this app make images
 * yet" — where the registries are provider-keyed. The dots are the readiness
 * summary; with the whole list on screen they answer "am I set up" without a
 * "4 of 6 ready" line of its own.
 */
import type { JSX } from "react";
import type { CapabilityView } from "@models/settings/capability-views.ts";
import { StateDot } from "./state-dot.tsx";
import { Note } from "@design-system/components/note.tsx";

export function CapabilityColumn({
	capabilities,
	selected,
	onSelect,
}: {
	capabilities: CapabilityView[] | null;
	selected: string | null;
	onSelect: (capability: string) => void;
}): JSX.Element {
	if (!capabilities) return <Note tone="muted">loading…</Note>;
	return (
		<ul className="settings-rows" aria-label="Capabilities">
			{capabilities.map((item) => (
				<li key={item.id}>
					<SelectionRow
						className="settings-row"
						selected={selected === item.id}
						aria-current={selected === item.id ? "true" : undefined}
						onClick={() => onSelect(item.id)}
					>
						<StateDot state={item.state} />
						<span className="settings-row-label">{item.label}</span>
					</SelectionRow>
				</li>
			))}
		</ul>
	);
}
