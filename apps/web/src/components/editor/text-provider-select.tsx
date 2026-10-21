import { Callout } from "@design-system/components/note.tsx";
/* The AI text provider control.
 *
 * Every option rendered here comes from the API, which reads it from provider
 * metadata. No model list, no thinking-level list, and no provider name appears
 * as a literal in this file — the runners genuinely disagree (codex offers
 * `off` but not `max`, claude the reverse), so a hardcoded union would be wrong
 * for every provider individually and would rot the moment a runner gains a
 * model. That is also why adding a model needs no edit here.
 *
 * Provider, model and thinking level are submitted together, never separately:
 * changing provider while leaving the model behind points the selection at the
 * previous provider's catalog, which then fails at the next generation rather
 * than at the moment the user made the change. */
import { type JSX } from "react";
import { Select } from "@design-system/components/select.tsx";
import { Field } from "@design-system/components/field.tsx";

export type ProviderHealth = "ready" | "unconfigured" | "down";

export interface TextProviderOption {
	id: string;
	label: string;
	models: string[];
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
	effective_provider: string | null;
	selection_error?: string | null;
	source: "settings" | "env" | "default";
	providers: TextProviderOption[];
}

/* Build the choice to submit when the user picks a provider.
 *
 * Model and thinking level are reset to the new provider's own first options
 * rather than carried across. Carrying them is the torn-write bug in slow
 * motion: the selection then names a model the new provider has never heard of,
 * and it surfaces at the next generation instead of at the click.
 *
 * A pure function so the invariant is testable — a static render cannot fire a
 * change event, so asserting this through the DOM proves nothing. */
export function choiceForProvider(
	providerId: string,
	providers: TextProviderOption[],
): TextProviderChoice {
	if (!providerId) return { providerId: "" };
	const next = providers.find((p) => p.id === providerId);
	return {
		providerId,
		model: next?.models[0],
		thinking: next?.thinking_levels[0],
	};
}

export function TextProviderSelect({
	status,
	busy,
	onChange,
}: {
	status: TextProviderStatus;
	busy: boolean;
	onChange: (choice: TextProviderChoice) => void;
}): JSX.Element {
	const selectedId = status.selected?.providerId ?? "";
	const selected = status.providers.find((p) => p.id === selectedId) ?? null;
	const effective = status.providers.find((p) => p.id === status.effective_provider) ?? null;
	const effectiveLabel = effective?.label ?? status.effective_provider ?? "unavailable";

	// Model and level lists follow whichever provider is currently chosen, so
	// the control can never offer a model the selected provider does not have.
	const models = selected?.models ?? [];
	const levels = selected?.thinking_levels ?? [];
	const model = status.selected?.model ?? models[0] ?? "";
	const thinking = status.selected?.thinking ?? levels[0] ?? "";

	const pickProvider = (id: string): void => onChange(choiceForProvider(id, status.providers));

	return (
		<div className="fc-text-provider">
			<Field>
				<span>AI Provider</span>
				<Select
					value={selectedId}
					disabled={busy}
					onValueChange={(e) => pickProvider(e)}
					phoneBreakpoint={860}
					options={[
						{ value: "", label: "App default (" + String(effectiveLabel) + ")" },
						...(status.providers.map((provider) => ({
							value: provider.id,
							label:
								String(provider.label) +
								String(provider.health === "ready" ? "" : ` (${provider.health})`) +
								String(provider.supported ? "" : " — unsupported"),
							disabled: provider.health !== "ready",
						})) ?? []),
					]}
				/>
			</Field>

			{selected ? (
				<>
					<Field>
						<span>Model</span>
						<Select
							value={model}
							disabled={busy || models.length === 0}
							onValueChange={(e) => onChange({ providerId: selected.id, model: e, thinking })}
							phoneBreakpoint={860}
							options={[...(models.map((m) => ({ value: m, label: m })) ?? [])]}
						/>
					</Field>

					<Field>
						<span>Thinking</span>
						<Select
							value={thinking}
							disabled={busy || levels.length === 0}
							onValueChange={(e) => onChange({ providerId: selected.id, model, thinking: e })}
							phoneBreakpoint={860}
							options={[...(levels.map((level) => ({ value: level, label: level })) ?? [])]}
						/>
					</Field>
				</>
			) : null}

			{/* Why a provider is unavailable, not merely that it is. */}
			{status.providers
				.filter((p) => p.health !== "ready" && p.health_reason)
				.map((p) => (
					<p key={p.id} className="fc-cap-desc" role="status">
						{p.label}: {p.health_reason}
					</p>
				))}

			{/* Switching from a flat-rate subscription CLI to a metered API turns a
			    free call into a billed one with nothing else in the UI changing. */}
			{selected?.metered_per_token ? (
				<Callout role="status">
					{selected.label} bills per token. Generations will appear as real spend on the credit
					ledger.
				</Callout>
			) : null}

			{selected && !selected.supported ? (
				<Callout role="status">
					{selected.label} has not passed the generation parity checks. Prompts and reply parsing
					were tuned against the default provider, so output may be shaped differently.
				</Callout>
			) : null}
		</div>
	);
}
