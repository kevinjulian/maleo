import { Input, Textarea } from "@design-system/components/input.tsx";
/* Maleo — Library > Project Presets
 *
 * A Project Preset is one thing:
 *
 *     Project Preset = Project Materials + Video Template
 *
 * It used to be an open-ended bundle — style knobs, project references, settings,
 * pacing devices, creative direction — which meant it overlapped
 * with materials, with templates AND with project settings, and no operator could say
 * what picking one would change. This editor now shows only the two things a preset
 * decides. There is deliberately no top-level Style surface: style is material content
 * or a material-derived summary, not a third reusable creative source.
 *
 * The retired fields are still CARRIED, not dropped. A preset row written before this
 * change holds style/refs/settings/pacing values that projects created from
 * it still read, so editing its name here must not silently blank them.
 *
 * Snapshot model: editing a preset here never touches projects already created from it. */
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import {
	EMPTY_PRESET_MATERIAL_SELECTION,
	type ContentPreset,
	type ContentPresetBundle,
	type PresetMaterialSelection,
	type TimelineTemplate,
	isFixtureRow,
	presetBundle,
	presetVideoTemplateId,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button, ButtonLink } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { PresetUsageLine } from "./preset-usage-line.tsx";
import { Modal } from "@design-system/components/modal.tsx";
import { LibraryHeader } from "./library-chrome.tsx";
import {
	EmptyState,
	ErrorState,
	LoadingState,
	collectionPhase,
} from "@design-system/patterns/collection.tsx";
import { PageTitle } from "@design-system/components/page.tsx";
import { LibraryToolbar } from "./library-toolbar.tsx";
import { PresetMaterialPicker, useMaterialLibrary } from "./preset-material-picker.tsx";
import {
	createContentPreset,
	deleteContentPreset,
	getContentPresetUsage,
	listContentPresets,
	setDefaultContentPreset,
	updateContentPreset,
} from "@api/presets.ts";
import { listTimelineTemplates } from "@api/templates.ts";
import { Chip } from "@design-system/components/chip.tsx";
import "./presets-library.css";

interface EditorProps {
	initial: ContentPreset | null;
	onCancel: () => void;
	onSaved: () => void;
}

/* ── Bundle editor (create / edit) — reuses the editor's own panels ── */
function PresetEditor({ initial, onCancel, onSaved }: EditorProps): JSX.Element {
	// Editing a shipped preset produces a copy, so it opens with a distinct name
	// rather than silently creating a second "High-Energy Challenge".
	const cloningBuiltin = Boolean(initial && isFixtureRow(initial));
	const [name, setName] = useState(
		initial ? (cloningBuiltin ? `${initial.name} (copy)` : initial.name) : "",
	);
	const [description, setDescription] = useState(initial?.description ?? "");
	const [materials, setMaterials] = useState<PresetMaterialSelection>(
		() => initial?.bundle.materials ?? EMPTY_PRESET_MATERIAL_SELECTION,
	);
	const [videoTemplateId, setVideoTemplateId] = useState<string | null>(() =>
		initial ? presetVideoTemplateId(initial.bundle) : null,
	);
	const [templates, setTemplates] = useState<TimelineTemplate[]>([]);
	const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { materials: library } = useMaterialLibrary();

	useEffect(() => {
		let alive = true;
		void listTimelineTemplates()
			.then((list) => {
				if (alive) setTemplates(list);
			})
			.catch(() => {
				/* templates are optional */
			});
		return () => {
			alive = false;
		};
	}, []);

	const selectedTemplate = templates.find((t) => t.id === videoTemplateId) ?? null;

	const save = async (): Promise<void> => {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		setError(null);
		/* Carry the retired fields through untouched. A preset written before this
		 * change supplies style/refs/settings/pacing to the projects
		 * seeded from it; renaming it here must not blank what it supplies. The
		 * legacy template id is dropped from `settings` because `videoTemplateId`
		 * now owns that selection, and two fields for one choice is how they
		 * disagree. */
		const legacy = initial?.bundle;
		const legacySettings = { ...legacy?.settings };
		delete legacySettings.timelineTemplateId;
		const bundle: ContentPresetBundle = presetBundle({
			materials,
			videoTemplateId,
			style: legacy?.style ?? null,
			projectRefs: legacy?.projectRefs ?? {},
			settings: legacySettings,
			pacingDevices: legacy?.pacingDevices ?? {},
			direction: legacy?.direction,
		});
		try {
			// A builtin has no row to PATCH. Editing one clones it into a workspace
			// preset, which is why the server can reject writes to builtin ids
			// outright rather than trusting every UI path to get this right.
			if (initial && !isFixtureRow(initial)) {
				const usage = await getContentPresetUsage(initial.id).catch(() => null);
				if (usage && usage.using > 1) {
					const ok = window.confirm(
						`Saving this preset affects ${usage.using} projects that draw from it. Continue?`,
					);
					if (!ok) {
						setBusy(false);
						return;
					}
				}
				await updateContentPreset(initial.id, {
					name: trimmed,
					description: description.trim(),
					bundle,
				});
			} else await createContentPreset({ name: trimmed, description: description.trim(), bundle });
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<div className="pg pg-narrow">
			<div className="cat-head">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					{Ic.chevronLeft(ICON.md)} Back
				</Button>
				<PageTitle level="sub">
					{!initial ? "New preset" : cloningBuiltin ? "Copy preset" : "Edit preset"}
				</PageTitle>
			</div>

			{/* Name + description */}
			<div className="form">
				<label className="cat-field">
					<span className="cat-field-label">Name</span>
					<Input
						className="cat-input"
						value={name}
						placeholder="Preset name"
						disabled={busy}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>
				<label className="cat-field">
					<span className="cat-field-label">Description</span>
					<Textarea
						className="pl-textarea"
						value={description}
						placeholder="What this preset is for"
						disabled={busy}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</label>
			</div>

			{/* Materials — which reusable material each group draws from */}
			<section className="pl-section">
				<h2 className="pl-h2">Materials</h2>
				<p className="pl-lead">
					The generation context projects created from this preset start with.
				</p>
				<div className="pl-card">
					{/* An empty library made this screen a dead end: four "create one in
					    Library > Materials" sentences and nothing to click. A preset is
					    still Materials + Video Template, so this LINKS to where a material
					    is authored rather than inlining a second editor here. */}
					{library.length === 0 ? (
						<div className="pl-stack">
							<p className="pl-note">
								A Project Preset starts from reusable materials, and this workspace has none yet.
							</p>
							<ButtonLink
								variant="primary"
								size="sm"
								className="tw:self-start"
								href="/library/materials?new=story"
							>
								{Ic.plus(ICON.md)} Create the first material
							</ButtonLink>
						</div>
					) : (
						<PresetMaterialPicker
							materials={library}
							value={materials}
							disabled={busy}
							onChange={setMaterials}
						/>
					)}
				</div>
			</section>

			{/* Video Template — named by identity, never copied into the preset */}
			<section className="pl-section">
				<h2 className="pl-h2">Video Template</h2>
				<p className="pl-lead">The video structure, pacing, and timing projects are built to.</p>
				<div className="pl-narrow">
					{selectedTemplate ? (
						<div className="cv-preset-chosen">
							<span className="cv-preset-chosen-name">
								{Ic.layers(ICON.sm)} {selectedTemplate.name}
							</span>
							<span className="cv-preset-chosen-actions">
								<button
									type="button"
									className="cv-textbtn"
									onClick={() => setTemplatePickerOpen(true)}
								>
									Change
								</button>
								<button
									type="button"
									className="cv-textbtn"
									onClick={() => setVideoTemplateId(null)}
								>
									Remove
								</button>
							</span>
						</div>
					) : (
						<button
							type="button"
							className="cv-preset-empty"
							onClick={() => setTemplatePickerOpen(true)}
						>
							<span>No video template selected</span>
							<span className="cv-preset-empty-cta">Choose video template</span>
						</button>
					)}
				</div>
				{templatePickerOpen && (
					<Modal
						title="Choose a video template"
						sub="Video structure and timing applied to new projects."
						onClose={() => setTemplatePickerOpen(false)}
						width={520}
					>
						{templates.length === 0 ? (
							<p className="cv-cat-empty">No video templates available.</p>
						) : (
							<div className="cat-field">
								{templates.map((tpl) => (
									<button
										key={tpl.id}
										type="button"
										className="cv-addtile pl-pick"
										onClick={() => {
											setVideoTemplateId(tpl.id);
											setTemplatePickerOpen(false);
										}}
									>
										<span className="pl-pick-text">
											<span className="pl-strong">{tpl.name}</span>
											{tpl.description && <span className="pl-sub">{tpl.description}</span>}
										</span>
										{tpl.id === videoTemplateId && Ic.check(ICON.sm)}
									</button>
								))}
							</div>
						)}
					</Modal>
				)}
			</section>

			{error && <p className="cat-err">{error}</p>}
			<div className="cat-actions">
				<Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					loading={busy}
					disabled={!name.trim()}
					onClick={() => void save()}
				>
					Save preset
				</Button>
			</div>
		</div>
	);
}

/* ── List view ── */
export function PresetsLibrary({ initialEditId }: { initialEditId?: string }): JSX.Element {
	const [items, setItems] = useState<ContentPreset[]>([]);
	const [defaultId, setDefaultId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ preset: ContentPreset | null } | null>(null);
	const [query, setQuery] = useState("");
	const [openedInitialEditId, setOpenedInitialEditId] = useState("");

	const load = async (): Promise<void> => {
		setLoading(true);
		try {
			const list = await listContentPresets();
			setItems(list.items);
			setDefaultId(list.defaultId);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	useEffect(() => {
		if (!initialEditId || loading || openedInitialEditId === initialEditId) return;
		const preset = items.find((item) => item.id === initialEditId);
		if (!preset) return;
		setOpenedInitialEditId(initialEditId);
		setEditing({ preset });
	}, [initialEditId, items, loading, openedInitialEditId]);

	const chooseDefault = async (id: string): Promise<void> => {
		try {
			setDefaultId(await setDefaultContentPreset(defaultId === id ? null : id));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const remove = async (id: string): Promise<void> => {
		try {
			await deleteContentPreset(id);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	/* Presets were the one library surface with no search at all, so a workspace
	 * that had accumulated presets could only be read top to bottom. Matches name
	 * and description, which are the two fields a row shows. */
	const phase = collectionPhase({ count: items.length, loading, failed: error !== null });
	const sorted = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter((preset) =>
			`${preset.name} ${preset.description ?? ""}`.toLowerCase().includes(q),
		);
	}, [items, query]);

	if (editing) {
		return (
			<PresetEditor
				initial={editing.preset}
				onCancel={() => setEditing(null)}
				onSaved={() => {
					setEditing(null);
					void load();
				}}
			/>
		);
	}

	return (
		<div className="pg pg-narrow">
			<LibraryHeader
				type="presets"
				count={items.length}
				action={
					<Button variant="primary" size="sm" onClick={() => setEditing({ preset: null })}>
						{Ic.plus(ICON.md)} New preset
					</Button>
				}
			/>
			<LibraryToolbar query={query} onQuery={setQuery} placeholder="Search project presets" />

			{phase === "ready" && error && (
				<ErrorState
					inline
					title="That did not work."
					message={error}
					onRetry={() => void load()}
					retrying={loading}
				/>
			)}
			{phase === "loading" ? (
				<LoadingState label="Loading presets…" />
			) : phase === "failed" ? (
				<ErrorState
					title="Could not load presets"
					message="The server did not answer as expected."
					onRetry={() => void load()}
					retrying={loading}
				/>
			) : sorted.length === 0 ? (
				/* Two different empties, and saying the wrong one sends the operator to
				   create a preset they already have. */
				<EmptyState
					label={
						items.length === 0
							? "No presets yet. Create one to reuse a look across projects."
							: `No presets match “${query.trim()}”.`
					}
				/>
			) : (
				<div className="collection-rows">
					{sorted.map((preset) => {
						const isDefault = preset.id === defaultId;
						const builtin = isFixtureRow(preset);
						return (
							<div key={preset.id} className="collection-card collection-card-row">
								<div className="cat-row-main">
									<div className="cat-row-name">
										{preset.name}
										{builtin && <Chip className="pl-gap">built-in</Chip>}
										{isDefault && <Chip className="pl-gap">default</Chip>}
									</div>
									{preset.description && <div className="pl-row-sub">{preset.description}</div>}
									{/* Is this preset still what people use, or has everyone edited off it?
									    The reverse of the editor's section tag, from the same stored fact. */}
									<PresetUsageLine presetId={preset.id} />
								</div>
								<IconButton
									size="sm"
									on={isDefault}
									title={isDefault ? "Unset default" : "Set as default"}
									onClick={() => void chooseDefault(preset.id)}
								>
									{Ic.pin(ICON.sm)}
								</IconButton>
								<IconButton
									size="sm"
									title={builtin ? "Copy to a preset you can edit" : "Edit"}
									onClick={() => setEditing({ preset })}
								>
									{builtin ? Ic.layers(ICON.sm) : Ic.pen(ICON.sm)}
								</IconButton>
								{/* A builtin has no row behind it; the server 409s on delete, so the
								    control is absent rather than offered and refused. */}
								{!builtin && (
									<IconButton
										size="sm"
										danger
										title="Delete"
										onClick={() => void remove(preset.id)}
									>
										{Ic.trash(ICON.sm)}
									</IconButton>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
