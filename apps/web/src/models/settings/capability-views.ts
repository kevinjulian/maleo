/* What the provider settings surface receives.
 *
 * These mirror `apps/api/src/lib/application-capabilities.ts` and the provider
 * config route. Declared here rather than imported because the web app talks to
 * the API over HTTP and must not depend on its internals — the same boundary
 * every other view model in this directory keeps. */

export type ProviderState = "ready" | "unconfigured" | "down";
export type CapabilityState = "ready" | "not_configured";

export interface CapabilityProviderView {
	id: string;
	label: string;
	state: ProviderState;
	active: boolean;
}

export interface CapabilityView {
	id: string;
	label: string;
	description: string;
	state: CapabilityState;
	activeProviderId: string | null;
	providers: CapabilityProviderView[];
}

export type ProviderFieldKind = "url" | "text" | "secret" | "choice";

export interface ProviderFieldView {
	key: string;
	label: string;
	kind: ProviderFieldKind;
	required: boolean;
	help?: string;
	options?: { id: string; label: string }[];
	/** A value is present, from either the environment or storage. */
	set: boolean;
	source: "env" | "stored" | "unset";
	/* An environment variable overrides the stored value, so editing here has no
	 * effect. Reported rather than left for the operator to discover by watching
	 * a saved change do nothing. */
	shadowed: boolean;
	error?: string;
	/** Present for non-secret fields only. A secret is never returned. */
	value?: string | null;
	/** Present for secret fields only. */
	value_masked?: string | null;
}

export interface ProviderConfigView {
	provider: string;
	label: string;
	fields: ProviderFieldView[];
	/* Set when the provider's setup is an action rather than a form — local
	 * caption alignment is installed, not credentialed. */
	action?: "install-captions";
}

export interface ProviderTestResult {
	ok: boolean;
	/* Whether a connection was actually attempted. A provider that cannot be
	 * probed without doing real work declares no probe, and the surface must not
	 * report "connected" for what it only knows is "configured". */
	probed: boolean;
	reason?: string;
	message?: string;
}

/** What to tell the operator about a completed test. */
export function testResultMessage(result: ProviderTestResult): string {
	if (!result.ok) return result.message ?? result.reason ?? "Connection failed.";
	return result.probed
		? "Connection succeeded."
		: "Configuration looks complete. This provider cannot be reached without running a generation, so nothing was contacted.";
}

/** How a capability's readiness reads as one word. */
export function capabilityStateLabel(view: CapabilityView): string {
	if (view.state === "ready") {
		const chosen = view.providers.find((p) => p.active);
		return chosen ? chosen.label : "Ready";
	}
	return view.providers.length === 0 ? "Unavailable" : "Not set up";
}

/**
 * Whether a provider CAN serve — not whether it currently does.
 *
 * Being the default is carried separately: a row that showed "Active" in place of
 * "Ready" left no way to see that a configured provider was sitting unused.
 */
export function providerStateLabel(provider: CapabilityProviderView): string {
	switch (provider.state) {
		case "ready":
			return "Ready";
		case "down":
			return "Unreachable";
		case "unconfigured":
		default:
			return "Not configured";
	}
}

/**
 * The values worth sending on save.
 *
 * A blank field means "leave this alone", which is the promise the form makes
 * for a secret whose value it cannot show. Removal is the explicit delete
 * action, never an emptied input.
 */
export function pendingConfigValues(edits: Record<string, string>) {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(edits)) {
		if (value.trim()) out[key] = value.trim();
	}
	return out;
}
