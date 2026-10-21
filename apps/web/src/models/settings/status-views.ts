/* What the settings screen reads back from each service.
 *
 * These describe responses, not requests, so they sit in domain: the status
 * cards and the hooks that fetch them both name these without either one
 * importing the other.
 */
export interface GlobalKeyView {
	key: string;
	set: boolean;
	value_masked: string;
	source: "file" | "env" | "unset";
}

/* Providers are a derived list. This view used to carry one boolean per
 * provider, which meant the settings card had to grow a branch every time one
 * was registered — and it named those providers in the type, so it could not
 * describe a deployment running a third. */
export interface TtsProviderView {
	id: string;
	label: string;
	health: "ready" | "unconfigured" | "down";
	voices: Array<{ id: string; name: string; desc: string }>;
}

export interface TtsStatusView {
	providers: TtsProviderView[];
	selected_provider: string | null;
	effective_provider: string | null;
	selection_error: string | null;
	source: "global" | "env" | "default";
	ready: boolean;
	voices: Array<{ id: string; name: string; desc: string }>;
}

export interface ResearchStatusView {
	configured: boolean;
	url: string;
	connected: boolean;
	error?: string;
	toolCount?: number;
	allowedTools?: string[];
	searchTool?: string;
}

export interface LocalCaptionStatusView {
	ready: boolean;
	enabled: boolean;
	model: string;
	version: string;
	whisperDir: string;
	cacheDir: string;
	mainInstalled: boolean;
	modelInstalled: boolean;
	ffmpegInstalled: boolean;
	cacheBytes: number;
}

export type SettingsTab = "credits" | "services" | "env";
export type CreditTab = "balance" | "usage" | "transactions" | "policy";

/* A blank field leaves the stored value untouched, so only non-empty edits are
 * sent. Deleting a key is the explicit empty-string write, not a blank field —
 * otherwise every untouched input would clear its key. */
export function pendingKeyUpdates(edits: Record<string, string>): Record<string, string> {
	const updates: Record<string, string> = {};
	for (const [k, v] of Object.entries(edits)) {
		if (v !== undefined && v !== "") updates[k] = v;
	}
	return updates;
}

export function hasPendingEdits(edits: Record<string, string>): boolean {
	return Object.values(edits).some((v) => v !== "");
}
