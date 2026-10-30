import { useEffect, useRef, useState } from "react";
import { textSelectionSchema, type TextSelection } from "@maleo/shared";
import { fetchTextProviderStatus } from "@api/text-provider.ts";
import type { TextProviderStatus } from "@models/settings/text-provider.ts";

export interface ChatModelSelection {
	choice?: TextSelection;
	choices: Array<{ selection: TextSelection; source: "discovered" | "declared" }>;
	valid: boolean;
	loading: boolean;
	error: string | null;
	saving: boolean;
	saveError: string | null;
	select: (choice: TextSelection) => Promise<void>;
	retry: () => void;
	retrySave: () => void;
}

export function useChatModelSelection(input: {
	projectId: string | null;
	preference?: TextSelection;
	onSelect: (choice: TextSelection) => Promise<void>;
}): ChatModelSelection {
	const [status, setStatus] = useState<TextProviderStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const generation = useRef(0);
	const pending = useRef<TextSelection | undefined>(undefined);
	const latest = useRef(input);
	latest.current = input;
	const load = async (refresh = false): Promise<void> => {
		const version = generation.current;
		setLoading(true);
		setError(null);
		try {
			const next = await fetchTextProviderStatus(refresh);
			if (version === generation.current) setStatus(next);
		} catch {
			if (version === generation.current)
				setError("Could not load text models. Retry to check availability.");
		} finally {
			if (version === generation.current) setLoading(false);
		}
	};
	useEffect(() => {
		generation.current++;
		setStatus(null);
		setSaveError(null);
		setSaving(false);
		pending.current = undefined;
		if (input.projectId) void load();
		return () => {
			generation.current++;
		};
	}, [input.projectId]);

	const parsed = textSelectionSchema.safeParse(status?.selected ?? status?.effective_selection);
	const choice = input.preference ?? (parsed.success ? parsed.data : undefined);
	const choices = (status?.providers ?? []).flatMap((provider) =>
		(provider.model_options ?? []).map((option) => ({
			selection: {
				providerId: provider.id,
				model: option.id,
				...(choice?.providerId === provider.id &&
				choice.thinking &&
				provider.thinking_levels.includes(choice.thinking)
					? { thinking: choice.thinking }
					: {}),
			},
			source: option.source,
		})),
	);
	const provider = status?.providers.find((item) => item.id === choice?.providerId);
	const valid = Boolean(
		choice &&
		provider?.health === "ready" &&
		choices.some(
			(item) =>
				item.selection.providerId === choice.providerId && item.selection.model === choice.model,
		) &&
		(!choice.thinking || provider.thinking_levels.includes(choice.thinking)),
	);
	const discoveryError = status?.providers.find((item) => item.discovery?.status === "error")
		?.discovery?.error;
	const select = async (next: TextSelection): Promise<void> => {
		const version = generation.current;
		pending.current = next;
		setSaving(true);
		setSaveError(null);
		try {
			await latest.current.onSelect(next);
		} catch {
			if (version === generation.current)
				setSaveError("Model choice could not be saved. Retry before sending.");
		} finally {
			if (version === generation.current) setSaving(false);
		}
	};
	return {
		choice,
		choices,
		valid,
		loading,
		error: error ?? discoveryError ?? null,
		saving,
		saveError,
		select,
		retry: () => void load(true),
		retrySave: () => {
			if (pending.current) void select(pending.current);
		},
	};
}
