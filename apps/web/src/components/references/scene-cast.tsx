/* A scene's visual references: which PROJECT-selected entities apply to this scene.
 *
 * This replaces `SceneRefSelect` and `SceneRefsPanel`, which both offered the
 * whole workspace library and unioned it with the project's defaults. That let an
 * operator cast an entity the project had never selected — which looks like it
 * worked and then generates nothing, because `resolveEntityRefImages` resolves
 * declared ids through the project roster and skips what it cannot find.
 *
 * So the picker lists project selections, and anything else arrives through an
 * explicit add-from-library step that selects it into the project first. */
import { useState } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame } from "@design-system/components/frame.tsx";
import { getKind, referenceDisplayRole } from "@models/references/reference-vocabulary.ts";
import type { ProjectSelection, RefImage } from "@maleo/shared";
import { TIER_LABEL, tierOf } from "@models/references/tiers.ts";
import { resolveSelectionHints, type VisualMaterialReference } from "@maleo/shared";

export interface SceneCastPickerProps {
	/** Every entity known to the workspace, for the explicit add step. */
	library: RefImage[];
	projectSelection: ProjectSelection;
	sceneRefIds: string[];
	onToggleSceneRef: (id: string) => void;
	/** Selecting into the project — the step that makes an entity castable. */
	onSelectIntoProject: (id: string) => void;
	visualReferenceSettings?: readonly VisualMaterialReference[];
	sceneText?: string;
	sceneName?: string;
	label?: string;
}

export function SceneCastPicker({
	library,
	projectSelection,
	sceneRefIds,
	onToggleSceneRef,
	onSelectIntoProject,
	visualReferenceSettings = [],
	sceneText = "",
	sceneName,
	label = "Scene references",
}: SceneCastPickerProps): JSX.Element {
	const [addOpen, setAddOpen] = useState(false);
	const byId = new Map(library.map((r) => [r.id, r]));
	const castable = projectSelection.entityIds
		.map((id) => byId.get(id))
		.filter((r): r is RefImage => Boolean(r));
	const cast = castable.filter((r) => sceneRefIds.includes(r.id));
	const unselected = library.filter((r) => !projectSelection.entityIds.includes(r.id));

	const groups = [...new Set(castable.map(referenceDisplayRole))]
		.map((role) => ({
			role,
			meta: getKind(role),
			items: castable.filter((r) => referenceDisplayRole(r) === role),
		}))
		.filter((g) => g.items.length);
	const hintResolution =
		sceneRefIds.length === 0 && sceneText.trim()
			? resolveSelectionHints(visualReferenceSettings, sceneText)
			: { selectedIds: [], matches: [], ambiguous: [] };
	const hintById = new Map(
		hintResolution.matches.map((match) => [match.entityId, match.terms[0] ?? "selection hint"]),
	);
	const ambiguousIds = new Set(hintResolution.ambiguous.map((match) => match.entityId));

	return (
		<section className="cv-scenecast">
			<header className="cv-scenecast-h">
				<span className="cv-srefsel-title">
					{Ic.film(ICON.xs)} {label} <span className="cv-srefsel-count">{cast.length}</span>
				</span>
				<button className="cv-textbtn" onClick={() => setAddOpen((o) => !o)}>
					{addOpen ? "Done" : "Add from workspace library"}
				</button>
			</header>
			{sceneName && (
				<p className="cv-mid-sub">
					Used when generating <b>“{sceneName}”</b>. Only references this project has selected can
					be used.
				</p>
			)}

			{castable.length === 0 ? (
				<button className="cv-srefsel-empty" onClick={() => setAddOpen(true)}>
					{Ic.plus(ICON.sm)} This project has no references selected yet — add one from the
					workspace library
				</button>
			) : (
				<div className="cv-scenecast-groups">
					{groups.map((g) => (
						<div key={g.role} className="cv-srefsel-group">
							<span className="cv-srefsel-gh" style={{ color: `oklch(0.5 0.13 ${g.meta.hue})` }}>
								{Ic[g.meta.iconName]?.(10)} {g.meta.label}
							</span>
							<div className="cv-srefsel-thumbs">
								{g.items.map((r) => {
									const inScene = sceneRefIds.includes(r.id);
									const hinted = hintById.get(r.id);
									const tier = tierOf(r.id, {
										projectEntityIds: projectSelection.entityIds,
										sceneRefIds,
									});
									return (
										<button
											key={r.id}
											type="button"
											className={`cv-srefthumb tier-${tier} ${inScene || hinted ? "on" : ""}`}
											title={`${r.label} — ${inScene ? "Manual scene reference" : hinted ? `Hint: ${hinted}` : TIER_LABEL[tier]}`}
											aria-pressed={inScene}
											onClick={() => onToggleSceneRef(r.id)}
										>
											<Frame
												generated={!r.imageUrl}
												src={r.imageUrl}
												seed={r.seed}
												aspect={1}
												w="100%"
												fit="contain"
											/>
											<span className="cv-srefthumb-lbl">{r.label}</span>
											<span className="cv-srefthumb-mark">
												{inScene
													? Ic.check2(ICON.xs)
													: hinted
														? Ic.spark(ICON.xs)
														: Ic.plus(ICON.xs)}
											</span>
											{(inScene || hinted || ambiguousIds.has(r.id)) && (
												<span className="cv-srefthumb-reason">
													{inScene ? "Manual" : hinted ? `Hint: ${hinted}` : "Ambiguous"}
												</span>
											)}
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}

			{addOpen && (
				<div className="cv-scenecast-add">
					<div className="cv-scenecast-add-h">{Ic.layers(ICON.xs)} Workspace library</div>
					{unselected.length === 0 ? (
						<p className="cv-mid-sub">
							Every workspace reference is already selected by this project.
						</p>
					) : (
						<div className="cv-srefsel-thumbs">
							{unselected.map((r) => (
								<button
									key={r.id}
									type="button"
									className="cv-srefthumb tier-workspace"
									title={`${r.label} — ${TIER_LABEL.workspace}. Adding selects it into the project.`}
									onClick={() => {
										onSelectIntoProject(r.id);
										onToggleSceneRef(r.id);
									}}
								>
									<Frame
										generated={!r.imageUrl}
										src={r.imageUrl}
										seed={r.seed}
										aspect={1}
										w="100%"
										fit="contain"
									/>
									<span className="cv-srefthumb-lbl">{r.label}</span>
									<span className="cv-srefthumb-mark">{Ic.plus(ICON.xs)}</span>
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
