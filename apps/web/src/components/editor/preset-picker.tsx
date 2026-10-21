/* Maleo — Content-First Create · Content preset picker + override warning.
 *
 * Shared by two surfaces: the creation page (pick → seed a new project) and the
 * editor Style menu (pick → warn → override the open project). The picker only
 * lists and selects; callers decide seed vs override semantics. */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { ContentPreset } from "@maleo/shared";
import { Modal } from "@design-system/components/modal.tsx";
import { Checkbox } from "@design-system/components/checkbox.tsx";
import { elementLabel } from "@models/presets/element-labels.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { listContentPresets } from "@api/presets.ts";

interface PresetPickerModalProps {
	onPick: (preset: ContentPreset) => void;
	onClose: () => void;
	/** Copy shown under the title (e.g. seed vs override framing). */
	sub?: string;
}

export function PresetPickerModal({ onPick, onClose, sub }: PresetPickerModalProps): JSX.Element {
	const [items, setItems] = useState<ContentPreset[]>([]);
	const [defaultId, setDefaultId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		void listContentPresets()
			.then((list) => {
				if (!alive) return;
				setItems(list.items);
				setDefaultId(list.defaultId);
			})
			.catch((err) => {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, []);

	return (
		<Modal
			title="Choose a preset"
			sub={sub ?? "Applies style, references, and settings."}
			onClose={onClose}
			width={520}
		>
			{loading ? (
				<p className="cv-cat-empty">Loading presets…</p>
			) : error ? (
				<p className="fc-cap-desc" style={{ color: "var(--err)" }}>
					{error}
				</p>
			) : items.length === 0 ? (
				<p className="cv-cat-empty">No presets yet. Create one in Library → Presets.</p>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{items.map((preset) => (
						<button
							key={preset.id}
							type="button"
							className="cv-addtile"
							style={{ justifyContent: "space-between" }}
							onClick={() => onPick(preset)}
						>
							<span>
								{preset.name}
								{preset.id === defaultId ? " · default" : ""}
							</span>
							{Ic.chevR(ICON.sm)}
						</button>
					))}
				</div>
			)}
		</Modal>
	);
}

interface OverrideWarningModalProps {
	presetName: string;
	/** Element paths the apply will replace, because a defaulter supplied them. */
	replaced: readonly string[];
	/** Element paths the operator owns. Kept unless they opt in. */
	kept: readonly string[];
	onConfirm: (options: { overwriteOperatorEdits: boolean }) => void;
	onCancel: () => void;
}

/* Confirmation before an editor apply.
 *
 * It used to say "overrides this project's style, references, and settings" and then
 * replace every axis unconditionally, because the old rules had no way to know which
 * values the operator had chosen. With sources recorded it does know, so the apply
 * replaces INHERITED values only and this dialog reports exactly that.
 *
 * The report matters most for projects that predate provenance. Every element on those
 * reads as operator-owned, so an apply legitimately does nothing — and a dialog that
 * did not say so would look broken. Here it says "0 will be replaced", names what it is
 * keeping, and offers the opt-in that makes the apply do something. */
export function PresetOverrideWarning({
	presetName,
	replaced,
	kept,
	onConfirm,
	onCancel,
}: OverrideWarningModalProps): JSX.Element {
	const [overwrite, setOverwrite] = useState(false);
	const nothingToDo = replaced.length === 0 && !overwrite;

	return (
		<Modal title={`Apply “${presetName}”?`} onClose={onCancel} width={460}>
			<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				<p className="fc-cap-desc">
					{replaced.length === 0
						? "Nothing here is inherited, so there is nothing for this preset to fill."
						: `Replaces ${replaced.length} inherited ${replaced.length === 1 ? "value" : "values"}: ${replaced.map(elementLabel).join(", ")}.`}
				</p>
				{kept.length > 0 && (
					<div>
						<p className="fc-cap-desc" style={{ marginBottom: 4 }}>
							Keeps your {kept.length} {kept.length === 1 ? "edit" : "edits"}:
						</p>
						<p className="fc-cap-desc">{kept.map(elementLabel).join(", ")}</p>
					</div>
				)}
				{kept.length > 0 && (
					<div className="tl2-template-editor-check">
						<Checkbox
							id="preset-overwrite"
							checked={overwrite}
							onCheckedChange={(checked) => setOverwrite(checked)}
							aria-label="Overwrite my edits too"
						/>
						<label htmlFor="preset-overwrite">Overwrite my edits too</label>
					</div>
				)}
				<p className="fc-cap-desc">This does not affect other projects.</p>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
					<button type="button" className="cv-textbtn" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="cv-addtile"
						style={{ width: "auto", ...(overwrite ? { color: "var(--err)" } : {}) }}
						disabled={nothingToDo}
						onClick={() => onConfirm({ overwriteOperatorEdits: overwrite })}
					>
						Apply
					</button>
				</div>
			</div>
		</Modal>
	);
}
