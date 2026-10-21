/* What a version saved by an edit-only agent run records about that run
 * (`migrate-editor-to-shared-rust-core` 4.6): its id, and how many of the run's
 * editor commands the version holds. The run's next save executes only the rest
 * (`apps/api/src/modules/agents/core/edit-rebase.ts`); an editor that loaded the
 * version knows those commands are already in its document. Editor saves never
 * carry it: it is not part of the editor's document. */
export interface AgentEditMarker {
	runId: string;
	applied: number;
}

export function readAgentEditMarker(storyboard: unknown): AgentEditMarker | undefined {
	if (!storyboard || typeof storyboard !== "object" || !("agentEdit" in storyboard))
		return undefined;
	const marker = storyboard.agentEdit;
	if (!marker || typeof marker !== "object" || !("runId" in marker) || !("applied" in marker))
		return undefined;
	return typeof marker.runId === "string" && typeof marker.applied === "number"
		? { runId: marker.runId, applied: marker.applied }
		: undefined;
}
