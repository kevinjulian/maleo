/* One provider's setup form: what is stored, what is being typed, and the probe
 * that runs before any of it is saved. */
import { useCallback, useEffect, useState } from "react";
import {
	clearProviderField,
	fetchProviderConfig,
	runProviderInstall,
	saveProviderConfig,
	testProviderConfig,
} from "@api/capabilities.ts";
import {
	pendingConfigValues,
	type ProviderConfigView,
	type ProviderTestResult,
} from "@models/settings/capability-views.ts";

export interface ProviderConfigModel {
	config: ProviderConfigView | null;
	loading: boolean;
	busy: boolean;
	error: string | null;
	edits: Record<string, string>;
	dirty: boolean;
	testResult: ProviderTestResult | null;
	setEdit: (key: string, value: string) => void;
	resetEdits: () => void;
	save: () => Promise<void>;
	test: () => Promise<void>;
	clearField: (key: string) => Promise<void>;
	/** Run the provider's bespoke setup action, when it declares one. */
	install: () => Promise<void>;
	reload: () => Promise<void>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useProviderConfig(providerId: string | null): ProviderConfigModel {
	const [config, setConfig] = useState<ProviderConfigView | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

	const reload = useCallback(async () => {
		if (!providerId) {
			setConfig(null);
			return;
		}
		setLoading(true);
		try {
			setConfig(await fetchProviderConfig(providerId));
			setError(null);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setLoading(false);
		}
	}, [providerId]);

	useEffect(() => {
		// Switching provider drops both the draft and the previous probe: showing
		// one provider's "connection ok" beside another's form is a lie.
		setEdits({});
		setTestResult(null);
		void reload();
	}, [reload]);

	const setEdit = useCallback((key: string, value: string) => {
		setEdits((current) => ({ ...current, [key]: value }));
		// A probe describes the values it ran against. Editing invalidates it.
		setTestResult(null);
	}, []);

	const resetEdits = useCallback(() => {
		setEdits({});
		setTestResult(null);
	}, []);

	const save = useCallback(async () => {
		if (!providerId) return;
		setBusy(true);
		try {
			await saveProviderConfig(providerId, pendingConfigValues(edits));
			setEdits({});
			setError(null);
			await reload();
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	}, [providerId, edits, reload]);

	const test = useCallback(async () => {
		if (!providerId) return;
		setBusy(true);
		try {
			/* The values being typed, not the stored ones — that is the whole point
			 * of testing before saving. Fields left blank fall through to whatever is
			 * stored, so an operator changing one key of three does not have to
			 * retype the other two. */
			setTestResult(await testProviderConfig(providerId, pendingConfigValues(edits)));
			setError(null);
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	}, [providerId, edits]);

	const clearField = useCallback(
		async (key: string) => {
			if (!providerId) return;
			setBusy(true);
			try {
				await clearProviderField(providerId, key);
				setEdits((current) => {
					const next = { ...current };
					delete next[key];
					return next;
				});
				setError(null);
				await reload();
			} catch (caught) {
				setError(messageOf(caught));
			} finally {
				setBusy(false);
			}
		},
		[providerId, reload],
	);

	const install = useCallback(async () => {
		if (!providerId) return;
		setBusy(true);
		try {
			await runProviderInstall(providerId);
			setError(null);
			await reload();
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(false);
		}
	}, [providerId, reload]);

	return {
		config,
		loading,
		busy,
		error,
		edits,
		dirty: Object.values(edits).some((value) => value.trim().length > 0),
		testResult,
		setEdit,
		resetEdits,
		save,
		test,
		clearField,
		install,
		reload,
	};
}
