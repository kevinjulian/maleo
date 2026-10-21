import { SelectionRow } from "@design-system/components/selection-row.tsx";
/* Level 3: the providers that can serve one capability.
 *
 * ONE LINE PER ROW. The surface this replaces put installed-binary lists, cache
 * sizes, tool counts and a six-line safety warning onto shared cards, which made
 * the state — the only thing a list is read for — the hardest thing to find on
 * it. Everything else moved to the provider's own page.
 *
 * A row deliberately does NOT name an environment variable. A variable named in
 * a list is a form field that failed to exist.
 */
import type { JSX } from "react";
import type { CapabilityView } from "@models/settings/capability-views.ts";
import { providerStateLabel } from "@models/settings/capability-views.ts";
import { StateDot } from "./state-dot.tsx";
import { Note } from "@design-system/components/note.tsx";

export interface ProviderListProps {
	capability: CapabilityView;
	selected: string | null;
	onSelect: (providerId: string) => void;
}

/* No heading. The capability tab above is already lit with this name, and the
 * setup beside it is titled with the provider — a third label between them
 * repeated what both were saying. */
export function ProviderList({ capability, selected, onSelect }: ProviderListProps): JSX.Element {
	return (
		<div className="settings-provider-list">
			{capability.providers.length === 0 && (
				<Note tone="muted">
					No provider in this build can serve {capability.label.toLowerCase()} yet.
				</Note>
			)}

			<ul className="settings-rows">
				{capability.providers.map((provider) => (
					<li key={provider.id}>
						<SelectionRow
							className="settings-row"
							selected={selected === provider.id}
							onClick={() => onSelect(provider.id)}
							aria-current={selected === provider.id ? "true" : undefined}
						>
							<StateDot state={provider.state} />
							<span className="settings-row-label">{provider.label}</span>
							{/* Readiness and default are two different facts and sit at
							    opposite ends: one is whether it CAN serve, the other is
							    whether it DOES. Stacked together they read as one status
							    and an operator cannot tell a configured-but-unused provider
							    from the one actually in use. */}
							<span className="settings-row-meta">
								<span className="settings-row-state">{providerStateLabel(provider)}</span>
								{provider.active && <span className="settings-row-default">Default</span>}
							</span>
						</SelectionRow>
					</li>
				))}
			</ul>
		</div>
	);
}
