/* What a provider needs configured, declared as data.
 *
 * The settings form is built from this. Without it the surface hand-writes a form
 * per provider and lands exactly where the Services tab it replaces already was —
 * one bespoke card per service — only one abstraction layer higher. A provider
 * knows what it needs; anywhere else that knowledge is a copy that drifts from the
 * implementation reading it.
 *
 * Shared by server provider registries and browser-safe settings contracts. */

export type ProviderConfigFieldKind =
	// A service endpoint. Rendered as a URL input; stored in plain settings.
	| "url"
	// A non-secret value: a model name, an organisation id.
	| "text"
	// A credential. Masked on entry, written to encrypted storage, and never
	// returned by any endpoint. Declaring secrecy HERE is what stops a credential
	// being stored in plaintext because whoever wrote the form forgot which field
	// it was.
	| "secret"
	// One of a fixed set. `options` carries them.
	| "choice";

export interface ProviderConfigOption {
	id: string;
	label: string;
}

export interface ProviderConfigField {
	/* The key this value resolves under — and deliberately the same string the
	 * provider passes to `resolveConfig`, so there is one identifier per field and
	 * the environment-shadowing check cannot drift from it. */
	key: string;
	/** Human label for the form. Never the key itself. */
	label: string;
	kind: ProviderConfigFieldKind;
	/** Whether the provider can report `ready` without it. */
	required: boolean;
	/** Shown beneath the input. The place a provider's caveats belong. */
	help?: string;
	/** Required when `kind` is `choice`, meaningless otherwise. */
	options?: readonly ProviderConfigOption[];
}

/** True when a field's value belongs in encrypted storage rather than settings. */
export function isSecretField(field: ProviderConfigField): boolean {
	return field.kind === "secret";
}

/**
 * Keys a provider declares, paired with whether each is a secret.
 *
 * The shape `shadowedConfigKeys` takes, so the settings surface can report which
 * stored values an environment variable is overriding without restating any
 * provider's field list.
 */
export function declaredConfigKeys(
	fields: readonly ProviderConfigField[] | undefined,
): { key: string; secret: boolean }[] {
	return (fields ?? []).map((field) => ({ key: field.key, secret: isSecretField(field) }));
}
