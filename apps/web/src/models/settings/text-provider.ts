export type ProviderHealth = "ready" | "unconfigured" | "down";

export interface TextProviderOption {
	id: string;
	label: string;
	models: string[];
	model_options?: Array<{ id: string; source: "discovered" | "declared" }>;
	discovery?: {
		status: "ready" | "unconfigured" | "unsupported" | "error";
		models: string[];
		error?: string;
	};
	thinking_levels: string[];
	health: ProviderHealth;
	health_reason: string | null;
	metered_per_token: boolean;
	context_tokens: number;
	supported: boolean;
}

export interface TextProviderChoice {
	providerId: string;
	model?: string;
	thinking?: string;
}

export interface TextProviderStatus {
	selected: TextProviderChoice | null;
	effective_selection?: import("@maleo/shared").TextSelection | null;
	effective_provider: string | null;
	selection_error?: string | null;
	source: "settings" | "env" | "default";
	providers: TextProviderOption[];
}
