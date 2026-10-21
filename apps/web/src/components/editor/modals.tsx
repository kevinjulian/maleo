/* Maleo — Content-First Create · Modals */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { NOTE_KIND_ORDER } from "@models/references/reference-vocabulary.ts";
import type { NotePayload } from "@models/content/note-payload.ts";
import { Button } from "@design-system/components/button.tsx";
import { Modal } from "@design-system/components/modal.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
export type { NotePayload };

export const LIBRARY_PROMPT_PRESETS = [
	{
		id: "character",
		label: "Character",
		prompt:
			"Create character reference pack / sheet. Keep single character identity consistent across all poses and expressions. Show clean silhouette, readable anatomy, plain uncluttered background, even lighting, full-body framing, and multiple variations suitable for reusable content production.",
	},
	{
		id: "location",
		label: "Location",
		prompt:
			"Create location plate. Focus on setting layout, atmosphere, depth, lighting direction, material detail, and clean composition. No text overlay, no character as main subject, background should be production-ready for repeated scene use.",
	},
	{
		id: "props",
		label: "Props",
		prompt:
			"Create prop pack / object sheet. Focus on isolated objects with clear shape language, consistent style, multiple variations or angles, plain uncluttered background, and spacing that makes each prop easy to crop and reuse.",
	},
] as const;

export function appendPromptPreset(prompt: string, presetPrompt: string): string {
	const base = prompt.trimEnd();
	if (!base) return presetPrompt;
	if (base.includes(presetPrompt)) return base;
	return `${base}\n\n${presetPrompt}`;
}

/* ── Tags input — comma-separated, with quick suggestions ── */
interface TagsInputProps {
	value: string[];
	onChange: (tags: string[]) => void;
	suggestions?: readonly string[];
}
function TagsInput({ value, onChange, suggestions = [] }: TagsInputProps): JSX.Element {
	const [txt, setTxt] = useState((value || []).join(", "));
	const commit = (s: string): void =>
		onChange(
			s
				.split(",")
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean),
		);
	const addSug = (s: string): void => {
		const curTxt = txt.trim().replace(/,\s*$/, "");
		const ns = curTxt ? curTxt + ", " + s : s;
		setTxt(ns);
		commit(ns);
	};
	const cur = value || [];
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
			<Input
				value={txt}
				onChange={(e) => {
					setTxt(e.target.value);
					commit(e.target.value);
				}}
				placeholder="separate with commas, e.g. character, hero"
			/>
			{suggestions.length > 0 && (
				<div className="cv-tagsugs">
					{suggestions
						.filter((s) => !cur.includes(s))
						.map((s) => (
							<button type="button" key={s} className="cv-tagsug" onClick={() => addSug(s)}>
								+ {s}
							</button>
						))}
				</div>
			)}
			{cur.length > 0 && (
				<div className="cv-notetags">
					{cur.map((t) => (
						<span key={t} className="cv-notetag">
							{t}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

/* ════ Note modal ════ */
export interface NoteModalInitial {
	id?: string;
	label?: string;
	body?: string;
	tags?: string[];
	kind?: string;
	proofSource?: string;
	proofUrl?: string;
}
export interface NoteDetail {
	usedCount: number;
	isProjectRef: boolean;
	onToggleProjectRef: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}
interface NoteModalProps {
	initial: NoteModalInitial;
	onClose: () => void;
	onSave: (n: NotePayload) => void;
	detail?: NoteDetail;
}
export function NoteModal({ initial, onClose, onSave, detail }: NoteModalProps): JSX.Element {
	const [label, setLabel] = useState(initial.label || "");
	const [body, setBody] = useState(initial.body || "");
	const [tags, setTags] = useState<string[]>(initial.tags || (initial.kind ? [initial.kind] : []));
	const [proofSource, setProofSource] = useState(initial.proofSource || "");
	const [proofUrl, setProofUrl] = useState(initial.proofUrl || "");
	const isClaim = tags.includes("claim");
	const ready = label.trim() && body.trim();
	return (
		<Modal
			title={initial.id ? "Edit note" : "New note"}
			sub="Style / direction note for generation"
			onClose={onClose}
			width={440}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				<div>
					<ML>Title</ML>
					<Input
						autoFocus
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="e.g. Tone & style"
					/>
				</div>
				<div>
					<ML>Note body</ML>
					<Textarea
						rows={3}
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="e.g. Casual, honest, avoid hard-sell…"
						style={{ resize: "vertical", minHeight: 70 }}
					/>
				</div>
				<div>
					<ML>Tags</ML>
					<TagsInput value={tags} onChange={setTags} suggestions={NOTE_KIND_ORDER} />
				</div>
				{isClaim && (
					<>
						<div>
							<ML>Proof source</ML>
							<Input
								value={proofSource}
								onChange={(e) => setProofSource(e.target.value)}
								placeholder="e.g. 2,300 Shopee reviews / lab spec sheet"
							/>
						</div>
						<div>
							<ML>Proof URL</ML>
							<Input
								value={proofUrl}
								onChange={(e) => setProofUrl(e.target.value)}
								placeholder="https://…"
							/>
						</div>
						<div style={{ fontSize: 11.5, color: "var(--muted)" }}>
							Claim notes ground the agent: it only asserts claims with a source and attaches a
							proof overlay when the claim is spoken.
						</div>
					</>
				)}
				{detail && (
					<>
						<button
							type="button"
							className={`cv-deftoggle ${detail.isProjectRef ? "on" : ""}`}
							onClick={detail.onToggleProjectRef}
						>
							<span className="cv-deftoggle-box">{detail.isProjectRef && Ic.check2(ICON.xs)}</span>
							<span className="cv-deftoggle-txt">
								{Ic.spark(ICON.sm)} Use as project note — applies to every clip
							</span>
						</button>
						<div style={{ fontSize: 11.5, color: "var(--muted)" }}>
							{detail.usedCount > 0
								? `Used by ${detail.usedCount} clip${detail.usedCount === 1 ? "" : "s"}`
								: "Not attached to any clip yet"}
						</div>
					</>
				)}
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						borderTop: "1px solid var(--border)",
						paddingTop: 14,
					}}
				>
					{detail && (
						<>
							<Button variant="ghost" style={{ color: "var(--err)" }} onClick={detail.onDelete}>
								{Ic.trash(ICON.sm)} Delete
							</Button>
							<Button variant="ghost" onClick={detail.onDuplicate}>
								{Ic.layers(ICON.sm)} Duplicate
							</Button>
						</>
					)}
					<div style={{ flex: 1 }} />
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!ready}
						onClick={() =>
							onSave({
								label: label.trim(),
								body: body.trim(),
								tags,
								proofSource: isClaim && proofSource.trim() ? proofSource.trim() : undefined,
								proofUrl: isClaim && proofUrl.trim() ? proofUrl.trim() : undefined,
							})
						}
					>
						{Ic.check(ICON.sm)} Save
					</Button>
				</div>
			</div>
		</Modal>
	);
}
