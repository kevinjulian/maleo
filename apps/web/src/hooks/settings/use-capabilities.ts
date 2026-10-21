/* The one hook the provider surface runs on.
 *
 * Replaces `use-service-status.ts`, which held three independent pieces of state
 * for three hardcoded services. A provider added to a registry now appears here
 * with no change to this file — which was the whole point. */
import { useCallback, useEffect, useState } from "react";
import { activateProvider, fetchCapabilities } from "@api/capabilities.ts";
import type { CapabilityView } from "@models/settings/capability-views.ts";

export interface CapabilitiesModel {
	items: CapabilityView[] | null;
	loading: boolean;
	busy: boolean;
	error: string | null;
	reload: () => Promise<void>;
	activate: (capability: string, providerId: string | null) => Promise<void>;
	find: (capability: string) => CapabilityView | undefined;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useCapabilities(): CapabilitiesModel {
	const [items, setItems] = useState<CapabilityView[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			const { capabilities } = await fetchCapabilities();
			setItems(capabilities);
			setError(null);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const activate = useCallback(
		async (capability: string, providerId: string | null) => {
			setBusy(true);
			try {
				await activateProvider(capability, providerId);
				setError(null);
				// Re-read rather than patching locally: activating one provider changes
				// the active flag on its siblings and the capability's own readiness,
				// and a local patch is a second copy of that rule.
				await reload();
			} catch (caught) {
				setError(messageOf(caught));
			} finally {
				setBusy(false);
			}
		},
		[reload],
	);

	const find = useCallback(
		(capability: string) => items?.find((item) => item.id === capability),
		[items],
	);

	return { items, loading, busy, error, reload, activate, find };
}
