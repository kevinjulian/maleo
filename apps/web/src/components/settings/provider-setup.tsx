/* Level 4: one provider's setup.
 *
 * The form is GENERATED from the provider's declared fields. Hand-writing one
 * per provider is the surface this replaces, one abstraction higher — and the
 * provider knows what it needs, so anywhere else that knowledge is a copy that
 * drifts.
 *
 * This is also where the honest detail lives: the account-id/token pair, the
 * model knob, and the paragraph about pointing research at a browser profile
 * with no logged-in sessions. On a shared card those were noise; on the page for
 * the provider they describe, they are exactly right — which is what lets levels
 * 1-3 stay one line each.
 */
import type { JSX } from "react";
import type { CapabilityProviderView } from "@models/settings/capability-views.ts";
import type { ProviderConfigModel } from "@hooks/settings/use-provider-config.ts";
import { Button } from "@design-system/components/button.tsx";
import { StateDot } from "./state-dot.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Callout, Note } from "@design-system/components/note.tsx";

export interface ProviderSetupProps {
	provider: CapabilityProviderView;
	capabilityId: string;
	capabilityLabel: string;
	config: ProviderConfigModel;
	activating: boolean;
	onActivate: () => void;
	onBack: () => void;
}

export function ProviderSetup({
	provider,
	capabilityLabel,
	config,
	activating,
	onActivate,
	onBack,
}: ProviderSetupProps): JSX.Element {
	const fields = config.config?.fields ?? [];
	const canActivate = provider.state === "ready" && !provider.active;

	return (
		<section className="settings-setup">
			<button type="button" className="settings-back" onClick={onBack}>
				‹ {capabilityLabel}
			</button>

			<div className="settings-pane-head">
				<h2>
					{provider.label} <StateDot state={provider.state} />
				</h2>
			</div>

			{config.loading && <Note tone="muted">loading…</Note>}
			{config.error && (
				<Callout className="settings-setup-error" tone="error" role="alert">
					{config.error}
				</Callout>
			)}

			{/* Setup that is an install rather than a form. Local caption alignment
			    has no credential to enter — whisper.cpp and its model either are on
			    this machine or are not. */}
			{config.config?.action === "install-captions" && (
				<div className="form">
					<Note tone="muted">
						Aligns narration into captions on this machine, with no service to configure. Installs
						whisper.cpp and its model.
					</Note>
					<Button
						variant="primary"
						size="sm"
						onClick={() => void config.install()}
						disabled={config.busy || provider.state === "ready"}
					>
						{config.busy ? "installing…" : provider.state === "ready" ? "Installed" : "Install"}
					</Button>
				</div>
			)}

			{fields.length === 0 && !config.loading && !config.config?.action && (
				<Note tone="muted">This provider needs no configuration here.</Note>
			)}

			{fields.length > 0 && (
				<div className="form">
					{fields.map((field) => {
						/* Help and errors are ANNOUNCED, not just placed. They sat inside the
						 * `<label>` before, which meant a screen reader read the help as part
						 * of the field's name and never reported an error as an error. Both
						 * are described-by now, and the error line is a live region, so an
						 * operator who tabs past a bad key hears it when it appears rather
						 * than by finding it. */
						const helpId = field.help ? `${field.key}-help` : undefined;
						const problem = field.shadowed
							? "An environment variable is overriding this. Changes here have no effect until it is removed."
							: field.error;
						const problemId = problem ? `${field.key}-problem` : undefined;
						const describedBy = [helpId, problemId].filter(Boolean).join(" ") || undefined;
						const control = {
							id: field.key,
							value:
								config.edits[field.key] ?? (field.kind === "secret" ? "" : (field.value ?? "")),
							disabled: config.busy,
							"aria-describedby": describedBy,
							/* Only a reported error is invalid. A shadowed field is correct and
							 * ignored, which is a warning about precedence, not a bad value. */
							"aria-invalid": field.error ? true : undefined,
						} as const;
						/* A `div` with an explicit `<label for>`, not a wrapping label. The
						 * wrapping form is fine for a field that is only a label and a control,
						 * and wrong the moment the field also holds help and an error:
						 * everything inside a `<label>` becomes part of the control's NAME, so
						 * the input announced as "API key Found on your Pexels account page." —
						 * which the keyboard walkthrough caught and the screenshots could not.
						 * Help and errors are described-by instead, which is what
						 * `aria-describedby` is for. */
						return (
							<Field key={field.key} as="div">
								<label className="form-label" htmlFor={field.key}>
									{field.label}
									{!field.required && <em className="form-optional">optional</em>}
								</label>

								{field.kind === "choice" ? (
									<Select
										size="md"
										{...control}
										onValueChange={(value) => config.setEdit(field.key, value)}
										value={config.edits[field.key] ?? field.value ?? ""}
										options={[
											{ value: "", label: "Default" },
											...(field.options?.map((option) => ({
												value: option.id,
												label: option.label,
											})) ?? []),
										]}
									/>
								) : (
									<Input
										{...control}
										onChange={(e) => config.setEdit(field.key, e.target.value)}
										type={field.kind === "secret" ? "password" : "text"}
										/* A stored secret cannot be shown, so the placeholder carries the
										 * promise the save path keeps: leaving it blank changes nothing. */
										placeholder={
											field.kind === "secret"
												? field.set
													? `${field.value_masked ?? "stored"} — leave blank to keep`
													: "not set"
												: "not set"
										}
									/>
								)}

								{field.help && (
									<Note tone="muted" as="span" id={helpId}>
										{field.help}
									</Note>
								)}

								{/* Precedence that is implemented but not reported is how an operator
						    loses an afternoon to an edit that silently had no effect. */}
								{problem && (
									<Note
										tone={field.shadowed ? "warn" : "error"}
										as="span"
										id={problemId}
										role="alert"
									>
										{problem}
									</Note>
								)}

								{field.set && field.source === "stored" && (
									<button
										type="button"
										className="settings-field-clear"
										disabled={config.busy}
										onClick={() => void config.clearField(field.key)}
									>
										Remove stored value
									</button>
								)}
							</Field>
						);
					})}
				</div>
			)}

			{fields.length > 0 && (
				<div className="form-actions">
					<Button size="sm" onClick={() => void config.test()} disabled={config.busy}>
						{config.busy ? "checking…" : "Test connection"}
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => void config.save()}
						disabled={config.busy || !config.dirty}
					>
						Save
					</Button>
					{config.dirty && (
						<Button size="sm" onClick={config.resetEdits} disabled={config.busy}>
							Reset
						</Button>
					)}
				</div>
			)}

			{/* The result an operator needs at the moment they paste a key, not when
			    a generation fails hours later with nothing pointing back here. */}
			{config.testResult && (
				<p className={`settings-test mono small${config.testResult.ok ? " ok" : " err"}`}>
					{config.testResult.ok
						? "Connection succeeded."
						: (config.testResult.message ?? "Connection failed.")}
				</p>
			)}

			<div className="settings-activate">
				{provider.active ? (
					<span className="settings-active-note">Default for {capabilityLabel}</span>
				) : (
					<Button
						variant="primary"
						size="sm"
						onClick={onActivate}
						disabled={!canActivate || activating}
						title={
							provider.state === "ready"
								? undefined
								: "Configure this provider before making it the default"
						}
					>
						{activating ? "setting…" : "Set as Default Provider"}
					</Button>
				)}
			</div>
		</section>
	);
}
