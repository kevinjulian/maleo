/* The scene editor, in its drawer.
 *
 * Split out of `timeline-editor.tsx`: the drawer owns one piece of selection
 * state — `editorSceneId` — and everything drawn here exists only while that
 * state is set, which is the boundary `check:layers` asks a split to follow.
 *
 * The scrim is a real `<button>` rather than a styled `<div>`: it dismisses the
 * drawer, and a dismiss target that the keyboard cannot reach strands anyone not
 * using a pointer inside a modal surface. */
import type { JSX } from "react";
import type { ReferenceLibraryState } from "@hooks/editor/use-reference-library.ts";
import { SceneEditorDrawer } from "./scene-editor-drawer.tsx";

/* Derived from the drawer's own props rather than restated. These types are the
 * drawer's to define, and a second hand-written copy is one rename away from
 * disagreeing with it. */
type DrawerProps = Parameters<typeof SceneEditorDrawer>[0];

interface TimelineSceneDrawerProps extends Pick<
	DrawerProps,
	| "scene"
	| "index"
	| "aspect"
	| "projectReferences"
	| "projectId"
	| "genBusy"
	| "genEndBusy"
	| "onClose"
	| "onGenerate"
	| "onClearEnd"
	| "onUpd"
	| "onToggleRef"
> {
	/** One bag instead of four props: the drawer reads refs, setRefs, pool and
	 *  products, and the editor already holds them grouped. */
	library: ReferenceLibraryState;
}

export function TimelineSceneDrawer({
	scene,
	index,
	aspect,
	library,
	projectReferences,
	projectId,
	genBusy,
	genEndBusy,
	onClose,
	onGenerate,
	onClearEnd,
	onUpd,
	onToggleRef,
}: TimelineSceneDrawerProps): JSX.Element {
	return (
		<>
			<button className="tl2-scenedrawer-scrim" aria-label="Close scene editor" onClick={onClose} />
			<aside className="tl2-scenedrawer" aria-label="Scene editor">
				<SceneEditorDrawer
					scene={scene}
					index={index}
					aspect={aspect}
					refs={library.refs}
					setRefs={library.setRefs}
					pool={library.pool}
					projectReferences={projectReferences}
					products={library.products}
					projectId={projectId}
					genBusy={genBusy}
					genEndBusy={genEndBusy}
					onClose={onClose}
					onGenerate={onGenerate}
					onClearEnd={onClearEnd}
					onUpd={onUpd}
					onToggleRef={onToggleRef}
				/>
			</aside>
		</>
	);
}
