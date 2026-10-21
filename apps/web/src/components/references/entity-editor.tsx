/* One editor for a reference entity: role, label, description, canonical image.
 *
 * These four fields used to be spread across two surfaces and a tag array. Role
 * was edited as a tag, which is how an entity could end up carrying two of them,
 * and the description was presented as "Note" — an annotation. It is not: the
 * description reaches the reference map at generation time, so an operator
 * writing it is writing a generation input, and this form says so. */
import { useRef, useState } from "react";
import type { JSX } from "react";
import type { EntityDraft } from "@models/references/entity-draft.ts";
export type { EntityDraft };

import { ICON, Ic } from "@design-system/icons/index.tsx";
import { LIBRARY_PROMPT_PRESETS, appendPromptPreset } from "@components/editor/modals.tsx";
import { Modal } from "@design-system/components/modal.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { generateSceneImage, uploadReferenceImage } from "@api/media.ts";
import {
	REF_KIND_ORDER,
	getKind,
	referenceDisplayRole,
} from "@models/references/reference-vocabulary.ts";
import type { RefImage } from "@maleo/shared";
import { TIER_LABEL, type ReferenceTier } from "@models/references/tiers.ts";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";

/** How the canonical image is being acquired. An entity is not useful without
 *  one, so the editor owns generate and upload rather than assuming the image
 *  already exists somewhere and only taking a URL. */
type ImageSource = "generate" | "upload" | "url";

export interface EntityEditorProps {
	initial?: RefImage;
	projectId?: string | null;
	mode?: "full" | "identity";
	/** Where the entity currently sits, so the operator can see the consequence
	 *  of the actions offered below the form. */
	tier?: ReferenceTier;
	/** Whether this entity is the project's lead subject (`is_primary`), which
	 *  drives roster-size backfill at generation. Omitted when no project. */
	isPrimary?: boolean;
	onSetPrimary?: (next: boolean) => void;
	usedCount?: number;
	onToggleProjectSelection?: () => void;
	onDelete?: () => void;
	onClose: () => void;
	onSave: (draft: EntityDraft) => void;
}

export function EntityEditor({
	initial,
	projectId,
	mode = "full",
	tier = "workspace",
	isPrimary = false,
	onSetPrimary,
	usedCount = 0,
	onToggleProjectSelection,
	onDelete,
	onClose,
	onSave,
}: EntityEditorProps): JSX.Element {
	const [role, setRole] = useState(initial ? referenceDisplayRole(initial) : "character");
	const [label, setLabel] = useState(initial?.label ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [src, setSrc] = useState(initial?.imageUrl ?? "");
	// A generated entity opens on generate so regenerate is one click; an entity
	// whose image arrived some other way opens on the field that produced it.
	const [imageSource, setImageSource] = useState<ImageSource>(
		initial?.prompt ? "generate" : initial?.imageUrl ? "url" : "generate",
	);
	const [prompt, setPrompt] = useState(initial?.prompt ?? "");
	const [busy, setBusy] = useState<"generating" | "uploading" | null>(null);
	const [imageError, setImageError] = useState<string | null>(null);
	const [imageFailed, setImageFailed] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const full = mode === "full";

	const canSave = label.trim().length > 0 && !busy;
	const save = (): void => {
		if (!canSave) return;
		onSave({
			role,
			label: label.trim(),
			description: description.trim(),
			src: src.trim() || undefined,
			prompt: prompt.trim() || undefined,
		});
	};

	/* The prompt is sent exactly as written — no wrapper text — so a preset is an
	 * append into the box the operator can then edit. */
	const generate = async (): Promise<void> => {
		if (!prompt.trim()) return;
		setImageError(null);
		setBusy("generating");
		try {
			setSrc(
				await generateSceneImage({ visual: prompt, aspect: "1:1", refs: [], source: "reference" }),
			);
		} catch (err) {
			setImageError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const upload = async (file: File | null): Promise<void> => {
		if (!file) return;
		setImageError(null);
		setBusy("uploading");
		try {
			setSrc(await uploadReferenceImage(file, projectId));
			if (!label.trim()) setLabel(file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "));
		} catch (err) {
			setImageError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	return (
		<Modal
			title={initial ? "Edit reference" : "New reference"}
			sub={initial?.label}
			onClose={onClose}
			width={520}
			dock
			className="cv-entity-editor-modal"
		>
			<div className="cv-entity-editor">
				{full && (
					<div className="cv-entity-editor-media">
						<div className="cv-entity-editor-thumb">
							<Frame
								generated={!src}
								src={src || undefined}
								seed={initial?.seed ?? 0}
								aspect={1}
								w="100%"
								fit="contain"
							>
								{busy && <Shimmer />}
							</Frame>
						</div>
						<div className="cv-entity-editor-image">
							<div className="cv-imgsource">
								{(
									[
										["generate", "Generate"],
										["upload", "Upload"],
										["url", "URL"],
									] as const
								).map(([key, lbl]) => (
									<button
										key={key}
										type="button"
										className={imageSource === key ? "on" : ""}
										onClick={() => setImageSource(key)}
									>
										{lbl}
									</button>
								))}
							</div>

							{imageSource === "generate" && (
								<>
									<Textarea
										rows={3}
										value={prompt}
										onChange={(e) => setPrompt(e.target.value)}
										placeholder="e.g. character reference sheet, single identity, plain background"
										aria-label="Image prompt"
									/>
									<div className="cv-presetgrid">
										{LIBRARY_PROMPT_PRESETS.map((preset) => (
											<button
												key={preset.id}
												type="button"
												className="cv-presetbtn"
												onClick={() => setPrompt((cur) => appendPromptPreset(cur, preset.prompt))}
											>
												{preset.label}
											</button>
										))}
									</div>
									<Button
										variant="primary"
										size="sm"
										onClick={() => void generate()}
										disabled={!prompt.trim() || busy !== null}
									>
										{Ic.spark(ICON.sm)}{" "}
										{busy === "generating" ? "Generating…" : src ? "Regenerate" : "Generate image"}
									</Button>
									<span className="cv-field-hint-dim">Sends the prompt exactly as written.</span>
								</>
							)}

							{imageSource === "upload" && (
								<>
									<input
										ref={fileInputRef}
										type="file"
										accept="image/png,image/jpeg,image/webp,image/avif"
										style={{ display: "none" }}
										onChange={(e) => {
											void upload(e.currentTarget.files?.[0] ?? null);
											e.currentTarget.value = "";
										}}
									/>
									<Button
										variant="primary"
										size="sm"
										type="button"
										onClick={() => fileInputRef.current?.click()}
										disabled={busy !== null}
									>
										{Ic.upload(ICON.sm)}{" "}
										{busy === "uploading" ? "Uploading…" : src ? "Replace image" : "Choose image"}
									</Button>
									<span className="cv-field-hint-dim">PNG, JPG, WEBP, AVIF. Max 10MB.</span>
								</>
							)}

							{imageSource === "url" && (
								<Field>
									<span>Canonical image URL</span>
									<Input
										value={src}
										onChange={(e) => setSrc(e.target.value)}
										placeholder="https://example.com/image.png"
										aria-label="Canonical image URL"
									/>
								</Field>
							)}

							{imageError && (
								<div role="alert" className="cv-entity-editor-err">
									{imageError}
								</div>
							)}
						</div>
					</div>
				)}
				{!full && (
					<div
						className="cv-entity-editor-readonly-media"
						style={{ background: `oklch(0.6 0.12 ${(initial?.seed ?? 0) % 360})` }}
					>
						{src && !imageFailed ? (
							<img
								src={src}
								alt={label || initial?.label || "Reference image"}
								onError={() => setImageFailed(true)}
							/>
						) : (
							<span>{(label || initial?.label || "?").slice(0, 1).toUpperCase()}</span>
						)}
					</div>
				)}

				<Field>
					<span>Role</span>
					{/* One role, chosen from the constrained set. It is a property of the
					    entity, not a tag among tags, so changing it edits in place. */}
					<Select
						size="md"
						value={role}
						onValueChange={(e) => setRole(e)}
						aria-label="Role"
						options={[
							...(REF_KIND_ORDER.map((k) => ({ value: k, label: getKind(k).label })) ?? []),
						]}
					/>
				</Field>

				<Field>
					<span>Label</span>
					<Input
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="Anna"
						aria-label="Label"
					/>
				</Field>

				<Field>
					<span>Input scenario</span>
					<Textarea
						rows={3}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Use when scene mentions Anna, woman, red coat"
						aria-label="Input scenario"
					/>
					<span className="cv-field-hint">
						{Ic.spark(ICON.xs)} Default use-when text for materials that select this reference.
					</span>
				</Field>

				{full && (
					<div className="cv-entity-editor-tier">
						<span className="cv-tier-badge" data-tier={tier}>
							{TIER_LABEL[tier]}
						</span>
						{usedCount > 0 && (
							<span className="cv-entity-editor-used">{`Used in ${usedCount} place${usedCount === 1 ? "" : "s"}`}</span>
						)}
					</div>
				)}

				{full && onToggleProjectSelection && (
					<button
						className={`cv-deftoggle ${tier !== "workspace" ? "on" : ""}`}
						onClick={onToggleProjectSelection}
					>
						<span className="cv-deftoggle-box">{tier !== "workspace" && Ic.check2(ICON.xs)}</span>
						<span className="cv-deftoggle-txt">{Ic.spark(ICON.sm)} Selected by this project</span>
					</button>
				)}

				{full && onSetPrimary && tier !== "workspace" && (
					<button
						className={`cv-deftoggle ${isPrimary ? "on" : ""}`}
						onClick={() => onSetPrimary(!isPrimary)}
					>
						<span className="cv-deftoggle-box">{isPrimary && Ic.check2(ICON.xs)}</span>
						<span className="cv-deftoggle-txt">
							{Ic.pin(ICON.sm)} Lead subject — sets how many subjects the planner casts
						</span>
					</button>
				)}

				<div className="cv-modal-actions">
					{onDelete && (
						<Button variant="ghost" size="sm" style={{ color: "var(--err)" }} onClick={onDelete}>
							{Ic.trash(ICON.sm)} Delete
						</Button>
					)}
					<span style={{ flex: 1 }} />
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" onClick={save} disabled={!canSave}>
						Save
					</Button>
				</div>
			</div>
		</Modal>
	);
}
