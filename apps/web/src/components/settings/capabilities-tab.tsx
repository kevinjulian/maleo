/* The Capabilities tab: what this app can do, what can serve it, how that is
 * set up.
 *
 *   capability │ provider │ setup
 *
 * Lives here rather than in `pages/settings.tsx` because a page composes tabs;
 * the three columns and the state that binds them are this tab's own business.
 */
import { useCallback } from "react";
import type { JSX } from "react";
import type { CapabilitiesModel } from "@hooks/settings/use-capabilities.ts";
import { useProviderConfig } from "@hooks/settings/use-provider-config.ts";
import { CapabilityColumn } from "./capability-column.tsx";
import { ColumnHead } from "./column-head.tsx";
import { ProviderList } from "./provider-list.tsx";
import { ProviderSetup } from "./provider-setup.tsx";
import { Note } from "@design-system/components/note.tsx";

export interface CapabilitiesTabProps {
	capabilities: CapabilitiesModel;
	/** The capability the route named, if it named one. */
	detail?: string;
	/** The provider the route named, if it named one. */
	provider?: string;
	/** Columns side by side, so an unchosen column would be an empty pane. */
	wide: boolean;
	onNavigate: (next: { detail?: string; provider?: string }) => void;
}

export function CapabilitiesTab({
	capabilities,
	detail,
	provider,
	wide,
	onNavigate,
}: CapabilitiesTabProps): JSX.Element {
	const capabilityId = detail ?? (wide ? capabilities.items?.[0]?.id : undefined);
	const capability = capabilityId ? capabilities.find(capabilityId) : undefined;

	const selectedProviderId = ((): string | null => {
		if (provider) return provider;
		if (!wide || !capability) return null;
		/* The default provider first, so a wide viewport opens on what is actually
		 * serving this capability rather than on whatever sorts first. */
		return capability.activeProviderId ?? capability.providers[0]?.id ?? null;
	})();

	const selectedProvider = capability?.providers.find((p) => p.id === selectedProviderId) ?? null;
	const config = useProviderConfig(selectedProvider?.id ?? null);

	/* Built from the RESOLVED capability, not the routed one: on a wide viewport
	 * it may have been filled in rather than named, and a link built from
	 * `undefined` would drop the level it belongs to. */
	const goProvider = useCallback(
		(next: string) => onNavigate({ detail: capabilityId, provider: next }),
		[onNavigate, capabilityId],
	);

	const activate = useCallback(async () => {
		if (!capabilityId || !selectedProvider) return;
		await capabilities.activate(capabilityId, selectedProvider.id);
	}, [capabilities, capabilityId, selectedProvider]);

	/* Which column a narrow viewport shows. Driven by what the URL NAMES, not by
	 * what got selected: a filled-in selection driving this meant Back from a
	 * provider re-selected it immediately, so on a phone the back button did
	 * nothing at all. */
	const level = provider ? 4 : detail ? 3 : 2;

	return (
		<div className="settings-cols" data-level={level}>
			<div className="settings-col settings-col-caps">
				<ColumnHead>Capabilities</ColumnHead>
				<CapabilityColumn
					capabilities={capabilities.items}
					selected={capabilityId ?? null}
					onSelect={(next) => onNavigate({ detail: next })}
				/>
			</div>

			<div className="settings-col settings-col-providers">
				{/* Above the column's own title: it leaves this level, so it comes
				    before the thing that names the level. */}
				<button type="button" className="settings-back" onClick={() => onNavigate({})}>
					‹ Capabilities
				</button>
				<ColumnHead>Providers</ColumnHead>
				{capability ? (
					<ProviderList
						capability={capability}
						selected={selectedProvider?.id ?? null}
						onSelect={goProvider}
					/>
				) : (
					<Note tone="muted">Choose a capability.</Note>
				)}
			</div>

			<div className="settings-col settings-col-detail">
				{selectedProvider && capability ? (
					<ProviderSetup
						provider={selectedProvider}
						capabilityId={capability.id}
						capabilityLabel={capability.label}
						config={config}
						activating={capabilities.busy}
						onActivate={() => void activate()}
						onBack={() => onNavigate({ detail: capabilityId })}
					/>
				) : (
					<Note tone="muted">
						{capability && capability.providers.length === 0
							? `No provider in this build can serve ${capability.label.toLowerCase()} yet.`
							: capability
								? "Choose a provider."
								: ""}
					</Note>
				)}
			</div>
		</div>
	);
}
