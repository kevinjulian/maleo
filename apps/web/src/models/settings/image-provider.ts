export interface ImageProviderStatus {
	selected_provider: string | null;
	effective_provider: string | null;
	selection_error?: string | null;
	source: "global" | "env" | "default";
	worker_configured: boolean;
	providers: Array<{
		id: string;
		label: string;
		health: "ready" | "unconfigured" | "down";
	}>;
}

export function effectiveImageProviderLabel(status: ImageProviderStatus): string {
	return (
		status.providers.find((provider) => provider.id === status.effective_provider)?.label ??
		status.effective_provider ??
		"unavailable"
	);
}

export function imageProviderStatusMessage(input: {
	status: ImageProviderStatus | null;
	busy: boolean;
	error: string | null;
}): string {
	if (input.busy) return "Saving provider...";
	if (input.error) return input.error;
	if (!input.status) return "Loading image providers...";
	return input.status.selection_error ?? "";
}
