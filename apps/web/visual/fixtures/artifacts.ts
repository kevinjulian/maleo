/* Artifact envelopes for visual fixtures, built through the real write path so a
 * fixture renders exactly what a run would have sent. Deterministic id and time,
 * so a fixture is the same on every run. */
import { pipelineArtifactKinds, writeArtifact, type PipelineArtifact } from "@maleo/shared";

export function fixtureArtifact(kind: string, payload: unknown): PipelineArtifact {
	return writeArtifact(
		pipelineArtifactKinds,
		[],
		{
			kind,
			payload,
			producer: { type: "stage", stage: "plan", runId: "fixture-run" },
			projectId: "fixture-project",
		},
		{
			now: () => "2026-01-01T00:00:00.000Z",
			newId: () => `fixture-${kind}`,
		},
	).artifact;
}
