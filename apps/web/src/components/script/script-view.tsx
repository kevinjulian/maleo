/* The script, as one of the editor's views.
 *
 * It owns what only it needs — the density, its own frame generation, the
 * confirmation before a delete — and reads the editor's live `scenes` for
 * everything else. That split is why this is a component rather than more of
 * `create-content.tsx`: the region that owns a piece of state should own the code
 * that draws it, and the shell had grown past its line ceiling holding both.
 *
 * Nothing here holds a copy of any script text. An edit rewrites the same `Scene`
 * the timeline and the studio render, which is what makes the three views unable
 * to disagree without a sync step between them.
 */
import { useCallback, useState, useRef } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { ScriptTable } from "@components/script/script-table.tsx";
import { hasOverlap, scriptRows, type ScriptDensity } from "@models/script/script-rows.ts";
import { readableArcTerm, type ScriptArcRoles } from "@models/script/arc-chapters.ts";
import {
	toScriptMarkdown,
	parseScriptMarkdown,
	planScriptImport,
	canRegroupChapters,
	regroupChapters,
} from "@maleo/shared";
import { useSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import { useSceneGeneration } from "@hooks/timeline/use-scene-generation.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { GlobalSettings } from "@models/presets/creative-settings.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import type { Chapter, Config, ProjectSelection, RefImage, RefsState, Scene } from "@maleo/shared";
import { Toolbar, ToolbarAction, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import "./script-view.css";

const DENSITIES: ScriptDensity[] = ["outline", "read", "write"];

export interface ScriptViewProps {
	projectId: string;
	scenes: Scene[];
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	/** The document's chapters, subscribed by the shell so an edit re-renders. */
	chapters: readonly Chapter[];
	store: TimelineDocumentStore;
	config: Config;
	refs: RefsState;
	pool: RefImage[];
	projectReferences: ProjectSelection;
	settings: GlobalSettings;
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
	density: ScriptDensity;
	onDensityChange: (density: ScriptDensity) => void;
	/** The plan's arc and its per-chapter functions, for display only. */
	arcRoles?: ScriptArcRoles;
	/** Told which row the operator is in, so the shell can hand that scene to the
	 *  timeline when they switch views. Deliberately not state up there: the
	 *  current row changes as the cursor moves. */
	onCurrentSceneChange: (sceneId: number) => void;
}

export function ScriptView(props: ScriptViewProps): JSX.Element {
	const { scenes, setScenes, chapters, store, config, density } = props;
	const [genError, setGenError] = useState<string | null>(null);

	/* Frame generation for this view.
	 *
	 * Its own instance rather than the timeline's: the timeline derives the
	 * closures this needs from state it owns, and hoisting that whole graph out to
	 * share one instance would be a large change to a surface this work promised
	 * not to disturb. Two instances hold two busy maps and nothing else — the
	 * generation itself writes to the same `scenes` — so each view reports what it
	 * started, which is what an operator watching one of them wants.
	 *
	 * Speech has no equivalent: there is no per-scene synthesis path in the web
	 * API, only the agent's whole-storyboard pass. The table is told about each
	 * kind separately, so it offers only the one that exists. */
	const sceneRefs = useSceneRefs({
		pool: props.pool,
		projectReferences: props.projectReferences,
		settings: props.settings,
	});
	const gen = useSceneGeneration({
		projectId: props.projectId,
		scenes,
		setScenes,
		setGenErr: setGenError,
		upd: (id, field, value) =>
			setScenes((ss) => ss.map((s) => (s.id === id ? { ...s, [field]: value } : s))),
		settings: props.settings,
		config,
		refs: props.refs,
		sceneStart: (id) =>
			scenes
				.slice(
					0,
					Math.max(
						0,
						scenes.findIndex((s) => s.id === id),
					),
				)
				.reduce((sum, s) => sum + Math.max(0, s.dur || 0), 0),
		addVideoOverlay: () => {
			/* the script does not animate a scene; that is the timeline's */
		},
		visualPromptFor: sceneRefs.visualPromptFor,
		refsFor: sceneRefs.refsFor,
		characterDesc: sceneRefs.characterDesc,
		globalStyleRef: sceneRefs.globalStyleRef,
		ensureMediaAsset: props.ensureMediaAsset,
	});

	const rows = scriptRows({
		scenes,
		chapters,
		clips: store.getDoc().clips,
		hashContext: { stylePreset: config.styleName },
	});

	/* Chapters live on the document, so an edit writes there directly. A chapter
	 * the operator has never touched is DERIVED and not yet in the document —
	 * writing its title is what first commits it, which is also what stops the next
	 * read's seeding from overwriting the name they chose. */
	const onChapterEdit = useCallback(
		(chapterId: string, field: "title" | "brief", value: string) => {
			store.setDoc((doc) => {
				const existing = doc.chapters ?? [];
				const known = existing.some((c) => c.id === chapterId);
				const derived = scriptRows({ scenes, chapters: [...existing], clips: doc.clips }).find(
					(g) => g.chapter.id === chapterId,
				)?.chapter;
				const next = known
					? existing.map((c) => (c.id === chapterId ? { ...c, [field]: value || undefined } : c))
					: [
							...existing,
							{ id: chapterId, title: derived?.title ?? chapterId, [field]: value || undefined },
						];
				return { ...doc, chapters: next };
			});
		},
		[store, scenes],
	);

	/* Offered only when re-deriving would actually regroup the document. A project
	 * whose scenes carry nothing to group on would get back the single chapter
	 * already on screen, and a control that promises a change it cannot make is
	 * worse than no control.
	 *
	 * Deliberately NOT recovering membership from the plan's sections here. Doing
	 * that means matching scene names against section titles, which is a REPAIR
	 * for documents generated before scenes recorded their section — a one-off
	 * repair over stored documents, not a rule a live surface should apply. Grouping on a display string would let a
	 * rename re-chapter a video. Once the repair has run, the scenes carry the real
	 * field and this reads that. */
	const canRegroup = canRegroupChapters(scenes, chapters);

	/* The repair for a project generated before its scenes recorded their section:
	 * one chapter over the whole video, frozen there because seeding refuses to
	 * touch a document that already carries chapters — deliberately, so an operator
	 * who deleted them all does not have them grow back. An explicit action is the
	 * way out that does not overturn that decision behind their back. */
	const onRegroup = useCallback(() => {
		const authored = (chapters ?? []).filter((c) => c.title || c.brief);
		const losing = authored.length
			? `\n\nThis replaces ${authored.length} chapter(s) you have named, including ${authored
					.map((c) => `"${c.title}"`)
					.slice(0, 3)
					.join(", ")}. Titles and briefs written there are lost.`
			: "";
		const regrouped = regroupChapters(scenes);
		if (
			!window.confirm(
				`Regroup into ${regrouped.chapters.length} chapter(s) from the sections these scenes came from?${losing}`,
			)
		)
			return;
		/* Both halves, because a recovered membership is only a repair once it is
		 * WRITTEN DOWN. Chapters alone would leave the scenes still saying nothing,
		 * so the next derivation would collapse them again and the fix would last
		 * exactly as long as this render. */
		setScenes((ss) => {
			const bySceneId = new Map(regrouped.scenes.map((s) => [s.id, s]));
			return ss.map((s) => {
				const next = bySceneId.get(s.id);
				return next
					? {
							...s,
							sectionId: next.sectionId,
							...(next.sceneKind ? { sceneKind: next.sceneKind } : {}),
						}
					: s;
			});
		});
		store.setDoc((doc) => ({ ...doc, chapters: [...regrouped.chapters] }));
	}, [chapters, scenes, setScenes, store]);

	/* The confirmation lives HERE, not in the table, because what a removal costs
	 * is a property of the document rather than the row: the script does not own
	 * the overlays and audio that cross a scene, and deleting it silently would
	 * take them with it. */
	const onDelete = useCallback(
		(sceneId: number) => {
			const scene = scenes.find((s) => s.id === sceneId);
			const row = rows.flatMap((g) => g.rows).find((r) => r.scene.id === sceneId);
			if (!scene) return;
			const crossing =
				row && hasOverlap(row.overlaps)
					? `\n\nThis scene is crossed by ${[
							row.overlaps.overlays && `${row.overlaps.overlays} overlay(s)`,
							row.overlaps.music && `${row.overlaps.music} audio clip(s)`,
							row.overlaps.transitions && `${row.overlaps.transitions} transition(s)`,
						]
							.filter(Boolean)
							.join(", ")}, which the script does not own.`
					: "";
			if (!window.confirm(`Delete "${scene.name}"?${crossing}`)) return;
			setScenes((ss) => ss.filter((s) => s.id !== sceneId));
		},
		[scenes, rows, setScenes],
	);

	/* Export and import, in the view rather than the shell: the file IS the script,
	 * and nothing else in the editor has an opinion about it. */
	const onExport = useCallback(() => {
		/* Rendered from the ROWS, not re-grouped from the document. `scriptRows`
		 * derives chapter membership for projects that never had it written down;
		 * grouping again from the raw document would put every one of those scenes
		 * under "Unassigned" and the file would not match the table above it. */
		const markdown = toScriptMarkdown(
			rows.map((g) => ({ chapter: g.chapter, scenes: g.rows.map((r) => r.scene) })),
			{
				title: config.title?.trim() || "Script",
				voice: props.refs.speakers.find((s) => s.default)?.name,
				project: props.projectId,
			},
		);
		const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `${
			(config.title || "script")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/(^-|-$)/g, "") || "script"
		}.md`;
		link.click();
		URL.revokeObjectURL(url);
	}, [rows, config.title, props.projectId, props.refs.speakers]);

	/* Import applies TEXT and never removes a scene on its own.
	 *
	 * `planScriptImport` decides what a file would do without doing any of it, so
	 * the confirmation can state the consequence before anything is written — and a
	 * stale paste cannot delete an afternoon's work by being opened. Rows are
	 * matched on the identity in the heading, never the positional label. */
	const onImport = useCallback(
		async (file: File) => {
			const parsed = parseScriptMarkdown(await file.text());
			const plan = planScriptImport(parsed, { sceneIds: scenes.map((s) => s.id) });
			const notes = [
				plan.updates.length && `${plan.updates.length} scene(s) updated`,
				plan.creates.length && `${plan.creates.length} row(s) with no match — skipped`,
				plan.removals.length && `${plan.removals.length} scene(s) absent from the file — kept`,
				plan.unparsed.length && `${plan.unparsed.length} line(s) could not be read`,
			]
				.filter(Boolean)
				.join("\n");
			if (!plan.updates.length) {
				setGenError(`Nothing to apply.\n${notes}`);
				return;
			}
			if (!window.confirm(`Apply this script?\n\n${notes}`)) return;
			const byId = new Map(plan.updates.map((u) => [u.id, u.scene]));
			setScenes((ss) =>
				ss.map((s) => {
					const row = byId.get(s.id);
					return row
						? {
								...s,
								name: row.name,
								vo: row.vo,
								vis: row.vis,
								...(row.sfx ? { sfx: row.sfx } : {}),
							}
						: s;
				}),
			);
		},
		[scenes, setScenes],
	);

	const importRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<Toolbar label="Script tools" className="sc-density-bar">
				{/* The arc, named once for the whole script rather than repeated on every
				    chapter. Absent for a plan made before arcs existed. */}
				{props.arcRoles?.arc && (
					<div className="sc-arc" title="The story arc this script was drafted against">
						{readableArcTerm(props.arcRoles.arc)}
					</div>
				)}
				<ToolbarGroup label="Density">
					{DENSITIES.map((option) => (
						<ToolbarAction
							key={option}
							label={option}
							on={option === density}
							onAction={() => props.onDensityChange(option)}
						>
							{option}
						</ToolbarAction>
					))}
				</ToolbarGroup>
				<ToolbarGroup label="File" className="sc-file-actions">
					{canRegroup && (
						<ToolbarAction
							label="Regroup"
							hint="Re-derive chapters from the sections these scenes came from"
							onAction={onRegroup}
						>
							Regroup
						</ToolbarAction>
					)}
					<ToolbarAction label="Export" onAction={onExport}>
						Export
					</ToolbarAction>
					<ToolbarAction
						label="Import"
						hint="Import a Markdown script"
						onAction={() => importRef.current?.click()}
					>
						Import
					</ToolbarAction>
					<input
						ref={importRef}
						type="file"
						hidden
						accept=".md,text/markdown"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file) void onImport(file);
						}}
					/>
				</ToolbarGroup>
			</Toolbar>
			{genError && <p className="sc-error">{genError}</p>}
			<ScriptTable
				chapters={rows}
				density={density}
				defaultVoice={props.refs.speakers.find((s) => s.default)?.name}
				generating={gen.gen}
				onEdit={(sceneId, field, value) =>
					setScenes((ss) => ss.map((s) => (s.id === sceneId ? { ...s, [field]: value } : s)))
				}
				onChapterEdit={onChapterEdit}
				onDelete={onDelete}
				onRegenerateFrame={(sceneId) => gen.genFrame(sceneId)}
				onSelect={props.onCurrentSceneChange}
				arcRoles={props.arcRoles}
			/>
		</>
	);
}
