/* The .env keys.
 *
 * A blank input means "leave this key alone", which is why every value is masked and
 * the placeholder says so. Removing a key is the explicit delete action, not an
 * emptied field.
 *
 * One card per key rather than a table: these rows are independently edited forms,
 * not a dataset to scan across. As a table, a long key name, a masked value and a
 * password input competed for width no phone has — two columns carried
 * `white-space: nowrap` and there was no breakpoint at all.
 */
import type { JSX } from "react";
import type { GlobalKeysModel } from "@hooks/settings/use-global-keys.ts";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Input } from "@design-system/components/input.tsx";

export function EnvTable({
	keys,
	plain = false,
}: {
	keys: GlobalKeysModel;
	/* Rendered inside a column that already has its own edges. The card this
	 * draws otherwise is a box inside a box — see the settings surface, which
	 * separates by rule rather than by card. */
	plain?: boolean;
}): JSX.Element | null {
	if (!keys.items)
		return (
			<Note tone="muted" as="div">
				loading…
			</Note>
		);
	return (
		<div
			style={
				plain
					? undefined
					: {
							background: "var(--surface)",
							border: "1px solid var(--border)",
							borderRadius: 8,
							padding: 16,
						}
			}
		>
			<div className="settings-env-keys">
				{keys.items.map((it) => (
					<div className="settings-env-key" key={it.key}>
						<div className="settings-env-key-head">
							<span className="mono small settings-env-key-name">{it.key}</span>
							{it.set && (
								<Button
									size="sm"
									onClick={() => keys.deleteKey(it.key)}
									disabled={keys.busy}
									title={`remove ${it.key} from .env`}
								>
									Remove
								</Button>
							)}
						</div>
						<div className="mono small muted settings-env-key-current">
							{it.set ? it.value_masked : "—"} <span style={{ opacity: 0.6 }}>· {it.source}</span>
						</div>
						<label className="settings-env-key-field">
							<span className="mono muted small">New value</span>
							<Input
								type="password"
								placeholder={it.set ? "(unchanged)" : "(unset)"}
								value={keys.edits[it.key] ?? ""}
								onChange={(e) => keys.setEdit(it.key, e.target.value)}
								disabled={keys.busy}
							/>
						</label>
					</div>
				))}
			</div>

			<div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
				<Button variant="primary" size="sm" onClick={keys.save} disabled={!keys.dirty || keys.busy}>
					{keys.busy ? "saving…" : "Save changes"}
				</Button>
				<Button size="sm" onClick={keys.resetEdits} disabled={!keys.dirty || keys.busy}>
					Reset
				</Button>
				{keys.savedAt && (
					<span className="mono muted small">
						saved {new Date(keys.savedAt).toLocaleTimeString()}
					</span>
				)}
			</div>
			<p className="mono muted small" style={{ marginTop: 12 }}>
				note: blank field leaves the value untouched. Use "Remove" to delete a key from .env
				entirely.
			</p>
		</div>
	);
}
