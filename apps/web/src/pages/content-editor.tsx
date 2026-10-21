/* `/content/:id` — the content editor, on a project that exists.
 *
 * The other half of the split from `create.tsx`, which served this route and
 * `/create` from one component. `projectId` is required here rather than
 * optional: it used to do double duty as "no project yet" and "not in the
 * editor", which is what made the services ask for a `screen` string as well.
 * The route carries an id or this page does not render.
 */
import type { JSX } from "react";
import "./content-editor.css";
import { CreateContent, type CrumbSeg } from "@components/editor/create-content.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Callout } from "@design-system/components/note.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";
import { useEditorEngine } from "@hooks/editor/use-editor-engine.ts";
import type { LibraryType } from "@models/core/routing.ts";
import type { EditorMode } from "@stores/shell-chrome-store.ts";
import type { ScriptDensity } from "@models/script/script-rows.ts";

export interface ContentEditorPageProps {
	projectId: string;
	onExit: () => void;
	onOpenNav: () => void;
	onOpenLibrary?: (type: LibraryType, editId?: string) => void;
	/** Which of the editor's views to open on. The script has its own path, so a
	 *  link can land on it directly; after that the view is the editor's own tab
	 *  state, like the other two. */
	initialEditorMode?: EditorMode;
	initialScriptDensity?: ScriptDensity;
	crumbs: CrumbSeg[];
}

/* The editor mounts once the Rust engine has loaded: it is the only executor,
 * so there is nothing to edit with before it. */
export function ContentEditorPage({
	projectId,
	onExit,
	onOpenNav,
	onOpenLibrary,
	initialEditorMode,
	initialScriptDensity,
	crumbs,
}: ContentEditorPageProps): JSX.Element {
	const engine = useEditorEngine();
	if (engine.status === "loading")
		return (
			<div className="editor-engine-gate">
				<Spinner size="md" label="Starting the editor" />
			</div>
		);
	if (engine.status === "failed") {
		return (
			<div className="editor-engine-gate">
				<Callout as="div" tone="error" role="alert">
					<span>The editor could not start.</span>
					<Button type="button" size="sm" variant="secondary" onClick={engine.retry}>
						Retry
					</Button>
				</Callout>
			</div>
		);
	}
	return (
		<CreateContent
			projectId={projectId}
			executor={engine.executor}
			onExit={onExit}
			onOpenNav={onOpenNav}
			onOpenLibrary={onOpenLibrary}
			initialEditorMode={initialEditorMode}
			initialScriptDensity={initialScriptDensity}
			crumbs={crumbs}
		/>
	);
}
