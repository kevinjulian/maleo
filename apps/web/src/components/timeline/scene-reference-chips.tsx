/* The "References used" body, shared by every surface that shows a scene's cast.
 *
 * It exists because the two surfaces disagreed. The scene drawer read `refs` plus
 * `dropped` and warned about the subject cap; the edit modal read `refs` alone, so
 * a scene over the cap looked fine there while the drawer said two subjects would
 * be skipped. Neither showed ids the project had not attached, which resolve to
 * nothing at generation and used to leave no trace on any surface.
 *
 * Only the BODY is shared. Each caller keeps its own header — they differ in class,
 * icon size, and whether they carry a hint, and none of that was ever the problem.
 * What has to agree is which of the three sets get rendered.
 *
 * `roster-parity.test.ts` pins the sets. It cannot pin that a surface renders them,
 * which is exactly how the modal's gap survived: helper tests do not see reach.
 */
import type { JSX } from "react";
import { DEFAULT_CAST_SUBJECT_CAP } from "@maleo/shared";
import type { ResolvedSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import { Note } from "@design-system/components/note.tsx";

export function SceneReferenceChips({
	resolved,
	emptyHint,
}: {
	resolved: ResolvedSceneRefs;
	/** Copy for "nothing will render" — worded per surface, since the two describe
	 *  different ways of getting there. */
	emptyHint: string;
}): JSX.Element {
	const withFit = [
		...resolved.refs.map((ref) => ({ ref, dropped: false })),
		...resolved.dropped.map((ref) => ({ ref, dropped: true })),
	];
	const droppedCount = resolved.dropped.length;
	const missingCount = resolved.missing.length;

	return (
		<>
			{resolved.refs.length ? (
				<div className="tl2-refs-used">
					{withFit.map(({ ref, dropped }) => (
						<div
							key={ref.id}
							className={`tl2-ref-chip${dropped ? " dropped" : ""}`}
							title={
								dropped
									? `Skipped at generation — over the ${DEFAULT_CAST_SUBJECT_CAP}-subject limit`
									: (ref.description ?? ref.label)
							}
						>
							{ref.imageUrl ? (
								<img src={ref.imageUrl} alt="" />
							) : (
								<span className="tl2-ref-chip-empty">{ref.label.slice(0, 1).toUpperCase()}</span>
							)}
							<span>{ref.label}</span>
							<em>{dropped ? "won't render" : (ref.role ?? ref.tags?.[0] ?? "reference")}</em>
						</div>
					))}
				</div>
			) : (
				<Note>{emptyHint}</Note>
			)}
			{droppedCount > 0 && (
				<Note tone="error">
					Max {DEFAULT_CAST_SUBJECT_CAP} people/products per scene — {droppedCount} extra{" "}
					{droppedCount === 1 ? "subject is" : "subjects are"} skipped at generation to avoid
					blending identities.
				</Note>
			)}
			{/* A declared id with no roster entry has no chip above — there is no entity to
			    draw one from — so this note is the only place it can appear. The cap warning
			    cannot cover it: an id that never resolved never entered `dropped`. */}
			{missingCount > 0 && (
				<Note tone="error">
					{missingCount === 1 ? "1 reference is" : `${missingCount} references are`} not attached to
					this project, so {missingCount === 1 ? "it contributes" : "they contribute"} nothing at
					generation: {resolved.missing.join(", ")}. Attach {missingCount === 1 ? "it" : "them"} in
					References to use {missingCount === 1 ? "it" : "them"}.
				</Note>
			)}
		</>
	);
}
