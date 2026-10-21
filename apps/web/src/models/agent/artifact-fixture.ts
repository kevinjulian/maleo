/* Test and harness fixtures: an artifact envelope built through the real write
 * path, so what a test renders is what a run would have sent. */
import { pipelineArtifactKinds, writeArtifact, type PipelineArtifact } from "@maleo/shared";

export function fixtureArtifact(kind: string, payload: unknown): PipelineArtifact {
	return writeArtifact(
		pipelineArtifactKinds,
		[],
		{ kind, payload, producer: { type: "tool", tool: "fixture", runId: "j1" }, projectId: "p" },
		{ now: () => "2026-09-29T00:00:00.000Z", newId: () => `${kind}-fixture` },
	).artifact;
}
