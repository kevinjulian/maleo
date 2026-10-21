/* Custom clip templates — user-authored items that appear in the Motion, Text,
 * and Data sidebar menus next to the built-ins. Built-ins are read-only; these
 * add Create + Edit + Delete on top of the same renderers.
 *
 * A custom item is a saved variant of a base built-in: it reuses the base's
 * renderer (TextPreset id or infographic type) and field schema, storing only
 * the custom label/category/intent and default content. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, JSX, ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
	ClipTemplate,
	ClipTemplateCategory,
	ClipTemplateKind,
	TemplateParams,
	TextOverlay,
} from "@maleo/shared";
import { CLIP_TEMPLATE_CATEGORIES, oneOf } from "@maleo/shared";
import { CLIP_TEMPLATE_DND_MIME } from "@models/timeline/editor-media.ts";
import { isCommitEnter } from "@models/core/keys.ts";
import {
	defaultInfographicPayload,
	infographicPayloadFrom,
} from "@models/presets/generation-defaults.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { TEMPLATE_ITEMS, type TemplateItem } from "@models/clip-templates/registry.ts";
import { TemplateFieldsEditor } from "./template-fields-editor.tsx";
import {
	InfographicFields,
	InfographicTypePreview,
} from "@components/timeline/infographics/infographics-panel.tsx";
import { TextPresetPreview } from "@components/timeline/timeline-editor-panels.tsx";
import type { TemplateDropInfo } from "@models/timeline/timeline-drops.ts";
import {
	createClipTemplate,
	deleteClipTemplate,
	listClipTemplates,
	updateClipTemplate,
	saveCompositionTemplate,
} from "@api/templates.ts";
import type { CompositionConfig } from "@models/clip-templates/composition-config.ts";
import { compositionLayerOf } from "@models/timeline/text-animation-adapter.ts";
import {
	overlaysFromComposition,
	presetOfCompositionOverlay,
} from "@models/clip-templates/composition-overlays.ts";
import { MotionStudioModal } from "@components/timeline/motion/motion-studio-modal.tsx";
import type { BrandPalette } from "@models/timeline/panel-brand.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";

const CATEGORY_LABEL = {
	data: "Charts & Data",
	text: "Text",
	intro: "Intro & Outro",
	logo: "Logo & Branding",
} satisfies Record<ClipTemplateCategory, string>;

const textBases = (): Array<Extract<TemplateItem, { kind: "text" }>> =>
	TEMPLATE_ITEMS.filter((i): i is Extract<TemplateItem, { kind: "text" }> => i.kind === "text");
const dataBases = (): Array<Extract<TemplateItem, { kind: "data" }>> =>
	TEMPLATE_ITEMS.filter((i): i is Extract<TemplateItem, { kind: "data" }> => i.kind === "data");

function baseTextItem(preset: string): Extract<TemplateItem, { kind: "text" }> | undefined {
	return textBases().find((i) => i.preset === preset);
}
function baseDataItem(type: string): Extract<TemplateItem, { kind: "data" }> | undefined {
	return dataBases().find((i) => i.type === type);
}

/** Rebuild a placeable TemplateItem from a stored custom template, inheriting
 * the base renderer's field schema. Returns null if the base no longer exists. */
function reconstructCustomItem(ct: ClipTemplate): TemplateItem | null {
	if (ct.kind === "text") {
		const base = baseTextItem(ct.base);
		if (!base) return null;
		// The registry lookup IS the narrowing: `base.preset` is the same id as
		// `ct.base`, but typed, because it came from a `TemplateItem`. Asserting
		// `ct.base as TextPreset` claimed what the line above had already proved.
		return {
			kind: "text",
			preset: base.preset,
			label: ct.label,
			category: ct.category,
			intent: ct.intent,
			fields: base.fields,
			defaultParams: ct.config,
		};
	}
	const base = baseDataItem(ct.base);
	if (!base) return null;
	return {
		kind: "data",
		type: base.type,
		label: ct.label,
		category: ct.category,
		intent: ct.intent,
		payload: infographicPayloadFrom(base.type, ct.config),
	};
}

/** Drag payload for a custom item, mirroring the built-in preset tiles so it
 * drops onto the timeline through the same CLIP_TEMPLATE_DND_MIME path. Returns
 * null for kinds that cannot be reconstructed (missing base). */
function customDragPayload(t: ClipTemplate): TemplateDropInfo | null {
	if (t.kind === "composition") return { kind: "composition", config: t.config, label: t.label };
	if (t.kind === "text") {
		/* Looked up rather than asserted, which also aligns the drag path with the
		 * placement path: `reconstructCustomItem` already returns null for a base
		 * no longer in the registry, and this function's own contract says it
		 * returns null for one. Asserting `t.base` was a `TextPreset` claimed the
		 * lookup's answer without asking it. */
		const preset = baseTextItem(t.base)?.preset;
		return preset ? { kind: "text", preset, params: t.config } : null;
	}
	const item = reconstructCustomItem(t);
	return item?.kind === "data" && item.payload ? { kind: "data", payload: item.payload } : null;
}

/** Visual thumbnail for a custom item, matching the built-in preset tiles: a
 * live text-preset preview (compositions preview their first layer) or an
 * infographic preview for data items. */
function CustomTilePreview({
	template,
	brand,
	compact = false,
}: {
	template: ClipTemplate;
	brand?: BrandPalette;
	compact?: boolean;
}): JSX.Element {
	if (template.kind === "composition") {
		const primary = template.config.overlays[0];
		return (
			<TextPresetPreview
				preset={presetOfCompositionOverlay(primary)}
				content={primary?.content || template.label}
				params={primary?.params}
				brand={brand}
				compact={compact}
			/>
		);
	}
	if (template.kind === "text") {
		// Same lookup the placement path uses. A base that is no longer in the
		// registry cannot be placed (`reconstructCustomItem` returns null), so the
		// tile previews as the default rather than rendering an unknown preset id.
		return (
			<TextPresetPreview
				preset={baseTextItem(template.base)?.preset ?? "title"}
				content={template.label}
				params={template.config}
				brand={brand}
				compact={compact}
			/>
		);
	}
	return (
		<InfographicTypePreview
			payload={infographicPayloadFrom(
				baseDataItem(template.base)?.type ?? "stat_reveal",
				template.config,
			)}
			brand={brand}
			compact={compact}
		/>
	);
}

/** The kinds this form edits. A composition is authored in Motion Studio and
 *  saved by `saveCompositionTemplate`; this draft has no fields for one. */
type DraftKind = Exclude<ClipTemplateKind, "composition">;

/* One buffer for either editable kind. Both configs are JSON — a text draft
 * holds the preset's field params, a data draft an infographic payload — so the
 * TYPE is shared and only the shape differs, which is `base`'s business. */
interface Draft {
	id?: string;
	kind: DraftKind;
	label: string;
	intent: string;
	category: ClipTemplateCategory;
	base: string;
	config: TemplateParams;
}

function newDraft(kind: DraftKind): Draft {
	if (kind === "text") {
		const base = textBases()[0];
		return {
			kind,
			label: "",
			intent: "",
			category: "text",
			base: base?.preset ?? "",
			config: { ...base?.defaultParams },
		};
	}
	const base = dataBases()[0];
	const type = base?.type ?? "stat_reveal";
	return {
		kind,
		label: "",
		intent: "",
		category: "data",
		base: type,
		config: { ...(base?.payload ?? defaultInfographicPayload(type)) },
	};
}

function draftFromTemplate(ct: ClipTemplate & { kind: DraftKind }): Draft {
	const common = {
		id: ct.id,
		label: ct.label,
		intent: ct.intent,
		category: ct.category,
		base: ct.base,
	};
	// Built per arm rather than spread: a spread flattens `kind` and `config`
	// into two independent fields, and the union is the whole point.
	return ct.kind === "text"
		? { ...common, kind: "text", config: { ...ct.config } }
		: { ...common, kind: "data", config: { ...ct.config } };
}

interface MenuState {
	template: ClipTemplate;
	x: number;
	y: number;
	armDelete?: boolean;
}

/** Custom-templates section embedded in a sidebar menu. Renders a "New" button,
 * the user's saved items (left-click to place, right-click to Edit/Delete), and
 * the create/edit modal. */
export function CustomTemplatesBlock({
	kind,
	kinds,
	onPlace,
	onPlaceComposition,
	studio,
	brand,
	query,
	onCount,
	placeable = true,
	heading,
	children,
}: {
	heading?: string;
	children?: ReactNode;
	kind: DraftKind;
	kinds?: ClipTemplateKind[];
	onPlace: (item: TemplateItem) => void;
	onPlaceComposition?: (config: CompositionConfig, label?: string) => void;
	studio?: { aspect: number; brand?: BrandPalette };
	brand?: BrandPalette;
	query?: string;
	onCount?: (n: number) => void;
	/** False on the library surface: placing needs a timeline and a playhead, and the
	 *  library has neither. A tile there opens the editor instead of pretending to place. */
	placeable?: boolean;
}): JSX.Element {
	const [templates, setTemplates] = useState<ClipTemplate[]>([]);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [menu, setMenu] = useState<MenuState | null>(null);
	const [studioSession, setStudioSession] = useState<{
		id?: string;
		name: string;
		overlays: TextOverlay[];
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		const accept = new Set<ClipTemplateKind>(kinds ?? [kind]);
		listClipTemplates()
			.then((all) => setTemplates(all.filter((t) => accept.has(t.kind))))
			.catch(() => setError("Failed to load"));
	}, [kind, kinds]);
	useEffect(() => {
		reload();
	}, [reload]);

	const q = (query ?? "").trim().toLowerCase();
	const filtered = useMemo(
		() =>
			q
				? templates.filter(
						(t) => t.label.toLowerCase().includes(q) || t.intent.toLowerCase().includes(q),
					)
				: templates,
		[templates, q],
	);
	useEffect(() => {
		onCount?.(filtered.length);
	}, [filtered.length, onCount]);

	const bases =
		kind === "text"
			? textBases().map((b) => ({ id: b.preset, label: b.label }))
			: dataBases().map((b) => ({ id: b.type, label: b.label }));
	const baseFields = useMemo(
		() => (draft && draft.kind === "text" ? (baseTextItem(draft.base)?.fields ?? []) : []),
		[draft],
	);

	const save = (): void => {
		if (!draft || !draft.label.trim() || !draft.base || busy) return;
		setBusy(true);
		setError(null);
		const common = {
			label: draft.label.trim(),
			intent: draft.intent.trim(),
			category: draft.category,
			base: draft.base,
		};
		const input =
			draft.kind === "text"
				? { ...common, kind: "text" as const, config: draft.config }
				: { ...common, kind: "data" as const, config: draft.config };
		const op = draft.id ? updateClipTemplate(draft.id, input) : createClipTemplate(input);
		op.then(() => {
			setDraft(null);
			reload();
		})
			.catch(() => setError("Failed to save"))
			.finally(() => setBusy(false));
	};

	const remove = (t: ClipTemplate): void => {
		setMenu(null);
		deleteClipTemplate(t.id)
			.then(reload)
			.catch(() => setError("Failed to delete"));
	};
	const place = (t: ClipTemplate): void => {
		if (t.kind === "composition") {
			onPlaceComposition?.(t.config, t.label);
			return;
		}
		const item = reconstructCustomItem(t);
		if (item) onPlace(item);
	};
	const startDrag = (e: DragEvent<HTMLElement>, t: ClipTemplate): void => {
		const payload = customDragPayload(t);
		if (!payload) return;
		e.dataTransfer.setData(CLIP_TEMPLATE_DND_MIME, JSON.stringify(payload));
		e.dataTransfer.effectAllowed = "copy";
		e.dataTransfer.setDragImage(e.currentTarget, 24, 24);
	};
	const editTemplate = (template: ClipTemplate): void => {
		/* Every composition goes to the studio, or nowhere. The guard used to be
		 * `studio && kind === "composition"`, so a composition reached from a
		 * non-studio panel fell through into a draft form that has no fields for
		 * one — the discriminated config is what made that visible. */
		if (template.kind === "composition") {
			if (studio)
				setStudioSession({
					id: template.id,
					name: template.label,
					overlays: overlaysFromComposition(template.config, 0),
				});
			return;
		}
		setDraft(draftFromTemplate(template));
	};

	const onBaseChange = (base: string): void => {
		if (!draft) return;
		if (draft.kind === "text") {
			setDraft({ ...draft, base, config: { ...baseTextItem(base)?.defaultParams } });
			return;
		}
		// The Select's options are exactly `dataBases()`, so the lookup always hits
		// and its `type` is the narrowed id — no assertion needed to seed a default.
		const item = baseDataItem(base);
		const seed = item ? (item.payload ?? defaultInfographicPayload(item.type)) : undefined;
		setDraft({ ...draft, base, config: { ...seed } });
	};

	const createButton = (
		<Button
			variant={heading ? "ghost" : "primary"}
			size="sm"
			aria-label={`New ${kind === "data" ? "data" : "motion"}`}
			style={!heading && placeable ? { width: "100%", justifyContent: "center" } : undefined}
			onClick={() => {
				setError(null);
				if (studio) setStudioSession({ name: "", overlays: [] });
				else setDraft(newDraft(kind));
			}}
		>
			{Ic.plus(ICON.sm)} {heading ? "New" : `New ${kind === "data" ? "data" : "motion"}`}
		</Button>
	);
	return (
		<div className="tl2-ct">
			{heading ? (
				<div className="tl2-elgroup-h">
					<span>{heading}</span>
					{createButton}
				</div>
			) : (
				createButton
			)}
			{error && <p className="tl2-ct-err">{error}</p>}
			{children}
			{filtered.length > 0 &&
				(placeable ? (
					<MediaGrid label="Saved elements" min={72} density="compact">
						{filtered.map((t) => (
							<MediaCard
								key={t.id}
								variant="picker"
								title={t.label}
								label={`Add ${t.label}`}
								ground="var(--media-bg)"
								preview={<CustomTilePreview template={t} brand={brand} compact />}
								onActivate={() => place(t)}
								draggable
								onDragStart={(event) => startDrag(event, t)}
								onContextMenu={(event) => {
									event.preventDefault();
									setMenu({ template: t, x: event.clientX, y: event.clientY });
								}}
								hint={`${t.label} · Add, or drag to the timeline · right-click to edit or delete`}
							/>
						))}
					</MediaGrid>
				) : (
					<div className="fc-tiles fc-data-tiles fc-template-tiles">
						{filtered.map((t) => (
							<button
								key={t.id}
								type="button"
								className="fc-tile fc-data-tile fc-template-tile"
								draggable={placeable}
								onDragStart={(e) => {
									if (placeable) startDrag(e, t);
								}}
								onClick={() => (placeable ? place(t) : editTemplate(t))}
								onContextMenu={(e) => {
									e.preventDefault();
									setMenu({ template: t, x: e.clientX, y: e.clientY });
								}}
								title={
									placeable
										? "Add, or drag to the timeline · right-click to edit or delete"
										: "Edit · right-click for more"
								}
							>
								<CustomTilePreview template={t} brand={brand} />
								<span className="fc-template-label">
									<b>{t.label}</b>
									<em>{t.intent || CATEGORY_LABEL[t.category]}</em>
								</span>
							</button>
						))}
					</div>
				))}

			{draft &&
				createPortal(
					<div role="presentation" className="tl2-ct-modal-scrim" onClick={() => setDraft(null)}>
						<div role="presentation" className="tl2-ct-modal" onClick={(e) => e.stopPropagation()}>
							<PanelHeader
								title={`${draft.id ? "Edit" : "New"} ${kind === "data" ? "data item" : "motion"}`}
								onClose={() => setDraft(null)}
							/>
							<div className="tl2-ct-modal-body">
								<Field>
									<span>Name</span>
									<Input
										autoFocus
										maxLength={80}
										value={draft.label}
										placeholder="Item name"
										onChange={(e) => setDraft({ ...draft, label: e.target.value })}
									/>
								</Field>
								<Field>
									<span>Description</span>
									<Input
										maxLength={160}
										value={draft.intent}
										placeholder="Short description"
										onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
									/>
								</Field>
								<div className="tl2-fields-2">
									<Field>
										<span>Base style</span>
										<Select
											value={draft.base}
											onValueChange={(e) => onBaseChange(e)}
											phoneBreakpoint={860}
											options={[...(bases.map((b) => ({ value: b.id, label: b.label })) ?? [])]}
										/>
									</Field>
									<Field>
										<span>Category</span>
										<Select
											value={draft.category}
											onValueChange={(e) => {
												const category = oneOf(e, CLIP_TEMPLATE_CATEGORIES);
												if (category) setDraft({ ...draft, category });
											}}
											phoneBreakpoint={860}
											options={[
												...(CLIP_TEMPLATE_CATEGORIES.map((c) => ({
													value: c,
													label: CATEGORY_LABEL[c],
												})) ?? []),
											]}
										/>
									</Field>
								</div>
								<div className="tl2-ct-fields">
									{draft.kind === "text" ? (
										<TemplateFieldsEditor
											fields={baseFields}
											values={draft.config}
											onChange={(config) => setDraft({ ...draft, config })}
										/>
									) : (
										<InfographicFields
											payload={infographicPayloadFrom(
												baseDataItem(draft.base)?.type ?? "stat_reveal",
												draft.config,
											)}
											onChange={(payload) => setDraft({ ...draft, config: { ...payload } })}
										/>
									)}
								</div>
								{error && <p className="tl2-ct-err">{error}</p>}
								<div className="tl2-ct-modal-actions">
									<Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
										Cancel
									</Button>
									<Button
										variant="primary"
										size="sm"
										disabled={!draft.label.trim() || !draft.base || busy}
										onClick={save}
									>
										{draft.id ? "Save changes" : "Create"}
									</Button>
								</div>
							</div>
						</div>
					</div>,
					document.body,
				)}

			{studioSession && studio && (
				<MotionStudioModal
					aspect={studio.aspect}
					brand={studio.brand}
					initial={studioSession.overlays.length || studioSession.id ? studioSession : undefined}
					onClose={() => setStudioSession(null)}
					onSaved={reload}
				/>
			)}
			{menu &&
				createPortal(
					<>
						<div
							aria-hidden="true"
							className="fc-ctx-scrim"
							onClick={() => setMenu(null)}
							onContextMenu={(e) => {
								e.preventDefault();
								setMenu(null);
							}}
						/>
						<div
							className="fc-ctx"
							style={{
								left: Math.min(menu.x, window.innerWidth - 200),
								top: Math.min(menu.y, window.innerHeight - 160),
							}}
						>
							<button
								className="fc-ctx-item"
								onClick={() => {
									if (studio && menu.template.kind === "text") {
										// Legacy single-item motion: open in the studio as a one-layer
										// session. Saving upgrades it to a composition in place.
										setStudioSession({
											id: menu.template.id,
											name: menu.template.label,
											overlays: [
												{
													id: Date.now(),
													content: "",
													start: 0,
													dur: 3,
													preset: baseTextItem(menu.template.base)?.preset ?? "title",
													track: 0,
													params: { ...menu.template.config },
													layout: {
														xPct: 8,
														yPct: 34,
														widthPct: 84,
														heightPct: 32,
														fit: "contain",
													},
												},
											],
										});
									} else {
										editTemplate(menu.template);
									}
									setMenu(null);
								}}
							>
								{Ic.edit(ICON.sm)} Edit
							</button>
							<div className="fc-ctx-sep" />
							<button
								className="fc-ctx-item danger"
								onClick={() => {
									if (menu.armDelete) remove(menu.template);
									else setMenu({ ...menu, armDelete: true });
								}}
							>
								{Ic.trash(ICON.sm)} {menu.armDelete ? "Confirm delete?" : "Delete"}
							</button>
						</div>
					</>,
					document.body,
				)}
		</div>
	);
}

/** "Save as motion" — serializes the given overlays (the multi-selection when
 * present, else the overlay being edited) into a composition template. Saving
 * under an existing motion's name overwrites it (the update flow). */
export function SaveAsMotionBlock({ overlays }: { overlays: TextOverlay[] }): JSX.Element {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<string | null>(null);

	const save = (): void => {
		const trimmed = name.trim();
		if (!trimmed || overlays.length === 0 || busy) return;
		setBusy(true);
		setNote(null);
		saveCompositionTemplate(trimmed, overlays.map(compositionLayerOf))
			.then(() => {
				setNote(`Saved "${trimmed}" to the Motion menu`);
				setName("");
			})
			.catch(() => setNote("Failed to save motion"))
			.finally(() => setBusy(false));
	};

	return (
		<div className="tl2-savemotion">
			<div className="tl2-anim-h">
				Save as motion{" "}
				<small>
					{overlays.length} layer{overlays.length === 1 ? "" : "s"} · reusable from the Motion menu
				</small>
			</div>
			<div className="tl2-savemotion-row">
				<Input
					type="text"
					placeholder="Motion name"
					maxLength={80}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (isCommitEnter(e)) save();
					}}
				/>
				<Button type="button" size="sm" disabled={!name.trim() || busy} onClick={save}>
					Save
				</Button>
			</div>
			{note && <small className="tl2-savemotion-note">{note}</small>}
		</div>
	);
}
