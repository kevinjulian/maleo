// Capability = a thing a workspace can be set up to do (post to Threads,
// generate images, send Telegram approvals, etc). The Settings tab is
// just a list of these. Behavior tab decides when each fires.

export type CapabilityId = "threads" | "instagram" | "image_gen" | "video_gen" | "telegram";

export type CapabilityGroup = "content" | "channels" | "ops";

export const GROUP_LABELS = {
	content: "Content",
	channels: "Channels",
	ops: "Ops",
} satisfies Record<CapabilityGroup, string>;

export const GROUP_BLURB = {
	content: "What kind of media this workspace can create",
	channels: "Where this workspace can publish",
	ops: "Approvals, alerts, operational tooling",
} satisfies Record<CapabilityGroup, string>;

export const GROUP_ORDER: CapabilityGroup[] = ["content", "channels", "ops"];

export type CapabilityStatus =
	| "ok"
	| "disabled"
	| "missing_secret"
	| "expired"
	| "rate_limited"
	| "not_configured"
	| "error";

export interface CapabilityCard {
	id: CapabilityId;
	group: CapabilityGroup;
	label: string;
	description: string;
	enabled: boolean;
	status: CapabilityStatus;
	status_detail: string | null;
	required_secrets: string[]; // secrets.yaml keys this capability needs
	missing_secrets: string[]; // subset of required_secrets that are absent
	refreshable_secrets: string[]; // subset wired into secret-refresh registry
	policy_key: string | null; // config.yaml block that holds the policy ("image_policy")
	policy: unknown; // current parsed policy (or null)
	metrics: Record<string, number | string> | null;
}

export interface CapabilityModule {
	id: CapabilityId;
	group: CapabilityGroup;
	label: string;
	description: string;
	required_secrets: string[];
	policy_key: string | null;
	// Compute status + optional metrics from workspace config + secrets + db.
	inspect(workspace: string): Promise<{
		status: CapabilityStatus;
		status_detail?: string;
		policy?: unknown;
		metrics?: Record<string, number | string>;
	}>;
}
