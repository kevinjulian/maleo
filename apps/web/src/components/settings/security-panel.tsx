import { SelectionRow } from "@design-system/components/selection-row.tsx";
/* Security & Privacy — the master key, what a rotation is waiting on, and which
 * stored values the environment is overriding.
 *
 * The shadowing report is what earns the rename from "Env". Precedence that is
 * implemented but not reported is how an operator sets a value here, watches an
 * environment variable silently win, and finds nothing anywhere that explains
 * it.
 *
 * The raw key table survives below as the advanced escape hatch — it is what
 * saves you when a provider's own form is the broken part.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import {
	cancelKeyRotation,
	fetchSecurityStatus,
	resetSecretStorage,
	rotateMasterKey,
	type SecurityStatus,
} from "@api/capabilities.ts";
import type { GlobalKeysModel } from "@hooks/settings/use-global-keys.ts";
import { Button } from "@design-system/components/button.tsx";
import { EnvTable } from "./env-table.tsx";
import { ColumnHead } from "./column-head.tsx";
import { SECURITY_TOPICS, securityTopicLabel, type SecurityTopicId } from "./security-topics.ts";
import { Note } from "@design-system/components/note.tsx";

/* Says what is true and what happens next — never "go configure an environment
 * variable", which is the sentence this whole surface exists to stop showing
 * someone. There is nothing for an operator to do in the `absent` case: the key
 * is created the first time they save a credential. */
const KEY_STATE_TEXT = {
	ready: "Your stored credentials are encrypted and readable.",
	absent: "No key yet. One is created automatically the first time you save a credential.",
	changed:
		"The key in your environment does not match the one your stored credentials were encrypted under, so they cannot be read. Restore the previous key, or re-enter the credentials.",
	uninitialized: "Ready. Nothing has been stored yet.",
} satisfies Record<SecurityStatus["master_key"]["state"], string>;

function keyLocation(master: SecurityStatus["master_key"]): string | null {
	if (master.source === "env") {
		return "Set by MALEO_MASTER_KEY in this deployment's environment, which takes precedence over the key file.";
	}
	if (master.source === "file" || master.source === "generated") {
		return `Kept at ${master.path}. Back it up: without it, stored credentials cannot be read.`;
	}
	return null;
}

export function SecurityPanel({
	keys,
	topic,
	onTopic,
	onBack,
}: {
	keys: GlobalKeysModel;
	/** null until the route names one. */
	topic: SecurityTopicId | null;
	onTopic: (next: SecurityTopicId) => void;
	onBack: () => void;
}): JSX.Element {
	const [status, setStatus] = useState<SecurityStatus | null>(null);
	const [newKey, setNewKey] = useState<string | null>(null);
	const [rotated, setRotated] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		try {
			setStatus(await fetchSecurityStatus());
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const cancel = useCallback(async () => {
		setBusy(true);
		try {
			await cancelKeyRotation();
			setNewKey(null);
			setError(null);
			await reload();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [reload]);

	const reset = useCallback(async () => {
		setBusy(true);
		try {
			await resetSecretStorage();
			setError(null);
			await reload();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [reload]);

	const rotate = useCallback(async () => {
		setBusy(true);
		try {
			const result = await rotateMasterKey();
			/* A key comes back only when this app cannot place it — i.e. when it
			 * lives in the environment. With a key file there is nothing to show and
			 * nothing to confirm: the rotation already finished. */
			setNewKey(result.key ?? null);
			setRotated(
				result.key
					? null
					: "Rotated. The new key is in the key file; every credential is still readable.",
			);
			setError(null);
			await reload();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [reload]);

	return (
		<div className="settings-cols settings-cols-2" data-level={topic ? 4 : 2}>
			<div className="settings-col settings-col-caps">
				<ColumnHead>Security &amp; Privacy</ColumnHead>
				<ul className="settings-rows">
					{SECURITY_TOPICS.map((item) => (
						<li key={item.id}>
							<SelectionRow
								className="settings-row"
								selected={topic === item.id}
								aria-current={topic === item.id ? "true" : undefined}
								onClick={() => onTopic(item.id)}
							>
								<span className="settings-row-label">{item.label}</span>
							</SelectionRow>
						</li>
					))}
				</ul>
			</div>

			<div className="settings-col settings-col-detail">
				{/* Same shape as a provider's setup in column three: the way back, the
				    title of what is open, then its content. */}
				{!topic && <Note tone="muted">Choose a topic.</Note>}

				{topic && (
					<section className="settings-security">
						<button type="button" className="settings-back" onClick={onBack}>
							‹ Security &amp; Privacy
						</button>

						<div className="settings-pane-head">
							<h2>{securityTopicLabel(topic)}</h2>
						</div>

						{error && (
							<Note tone="error" role="alert">
								{error}
							</Note>
						)}

						{topic === "master-key" && (
							<div className="form">
								<Note>{status ? KEY_STATE_TEXT[status.master_key.state] : "loading…"}</Note>

								{rotated && <Note className="settings-test ok">{rotated}</Note>}

								{status && keyLocation(status.master_key) && (
									<Note tone="muted">{keyLocation(status.master_key)}</Note>
								)}

								{status?.master_key.rotationPending && (
									<>
										<Note tone="error">
											A rotation is waiting. Both the old and the new key still open your
											credentials, and nothing is lost by restarting. It completes when this app
											next starts with the new key in its environment.
										</Note>
										{/* Without this the pending state is permanent for anyone who lost
									    the new key before saving it — the rotation can only complete
									    with a key they no longer have. */}
										<Button size="sm" onClick={() => void cancel()} disabled={busy}>
											{busy ? "discarding…" : "Discard the pending rotation"}
										</Button>
										<Note tone="muted">
											Keeps the key currently in force. Every stored credential stays readable.
										</Note>
									</>
								)}

								{/* Shown once. No later request returns it — losing it before it is
							    saved means rotating again, which is safe because the old key
							    still works. */}
								{newKey && (
									<div className="settings-newkey">
										<Note>
											Save this now as <code>MALEO_MASTER_KEY</code> in your deployment environment.
											It is shown once.
										</Note>
										<code className="settings-newkey-value">{newKey}</code>
									</div>
								)}

								{/* Rotation cannot run while the store is unopenable — it re-wraps
							    a data key it would first have to read. Offering it here would
							    hand the operator a button that returns the error they are
							    already looking at. */}
								{status?.master_key.state === "changed" ? (
									<>
										<Note tone="error">
											{status.unreadable?.secretCount
												? `Discarding will permanently remove ${status.unreadable.secretCount} stored credential(s) that no available key can read. Restoring the previous key is the only way to get them back.`
												: "Nothing readable is stored. Discarding lets you enter credentials again."}
										</Note>
										<Button
											variant="primary"
											size="sm"
											onClick={() => void reset()}
											disabled={busy}
										>
											{busy ? "discarding…" : "Discard unreadable credentials and start again"}
										</Button>
									</>
								) : (
									<>
										<Button size="sm" onClick={() => void rotate()} disabled={busy}>
											{busy ? "generating…" : "Regenerate master key"}
										</Button>
										<Note tone="muted">
											Rotating re-wraps one row. No provider needs configuring again.
										</Note>
									</>
								)}
							</div>
						)}

						{topic === "overrides" && (
							<div className="form">
								{status && status.shadowed.length === 0 && (
									<Note tone="muted">Nothing stored here is being overridden.</Note>
								)}
								{status && status.shadowed.length > 0 && (
									<>
										<Note tone="error">
											An environment variable is winning over the value stored here. Editing these
											in Settings will have no effect until the variable is removed.
										</Note>
										<ul className="settings-shadowed">
											{status.shadowed.map((key) => (
												<li key={key}>{key}</li>
											))}
										</ul>
									</>
								)}
							</div>
						)}

						{topic === "worker" && (
							<div className="form">
								<Note tone="muted">
									Durable generation runs in its own process. It reads the credentials stored here
									only when it is given <code>MALEO_API_URL</code> and
									<code> MALEO_SERVICE_TOKEN</code>; without them it reads its own environment
									instead, and what you set here will not reach it.
								</Note>
							</div>
						)}

						{topic === "raw" && (
							<div className="form">
								<Note tone="muted">
									The escape hatch for when a provider's own form is the broken part.
								</Note>
								<div className="settings-raw">
									<EnvTable keys={keys} plain />
								</div>
							</div>
						)}
					</section>
				)}
			</div>
		</div>
	);
}
