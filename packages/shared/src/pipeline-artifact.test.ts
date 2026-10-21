import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
	ArtifactKindRegistrationError,
	ArtifactWriteError,
	writeArtifact,
	artifactsOfKind,
	artifactContentHash,
	artifactRefOf,
	createArtifactKindRegistry,
	defineArtifactKind,
	isArtifactReady,
	parseArtifact,
	resolveArtifactRef,
	type PipelineArtifact,
	type StageResult,
} from "./pipeline-artifact.ts";
import {
	PIPELINE_ARTIFACT_KINDS,
	knowledgeArtifact,
	pipelineArtifactKinds,
	storyPlanArtifact,
} from "./pipeline-artifact-kinds.ts";

function artifact(
	kind: string,
	payload: unknown,
	overrides: Partial<PipelineArtifact> = {},
): PipelineArtifact {
	const schemaVersion = overrides.schemaVersion ?? 1;
	return {
		id: "art-1",
		kind,
		schemaVersion,
		status: "complete",
		producer: { type: "stage", stage: "plan", runId: "run-1" },
		projectId: "project-1",
		revision: 1,
		inputRefs: [],
		contentHash: artifactContentHash(kind, schemaVersion, payload),
		createdAt: "2026-09-29T00:00:00.000Z",
		payload,
		...overrides,
	};
}

const knowledge = { title: "Bees", body: "Workers are female." };

describe("artifact envelope (1.1)", () => {
	test("a valid envelope and payload are accepted", () => {
		const result = parseArtifact(pipelineArtifactKinds, artifact("knowledge", knowledge));
		expect(result.ok).toBe(true);
	});

	test("a stage or tool artifact without a run id is rejected", () => {
		const stage = {
			...artifact("knowledge", knowledge),
			producer: { type: "stage", stage: "plan" },
		};
		const tool = {
			...artifact("knowledge", knowledge),
			producer: { type: "tool", tool: "create_story_outline" },
		};
		expect(parseArtifact(pipelineArtifactKinds, stage)).toMatchObject({
			ok: false,
			reason: "envelope",
		});
		expect(parseArtifact(pipelineArtifactKinds, tool)).toMatchObject({
			ok: false,
			reason: "envelope",
		});
	});

	test("an editor artifact is accepted without a run id", () => {
		expect(
			parseArtifact(
				pipelineArtifactKinds,
				artifact("knowledge", knowledge, { producer: { type: "editor" } }),
			).ok,
		).toBe(true);
	});

	test("an input reference without a content hash is rejected", () => {
		const value = {
			...artifact("knowledge", knowledge),
			inputRefs: [{ id: "up-1", kind: "research_bundle", schemaVersion: 1 }],
		};
		expect(parseArtifact(pipelineArtifactKinds, value)).toMatchObject({
			ok: false,
			reason: "envelope",
		});
	});

	test("a content hash that does not match the payload is rejected", () => {
		const value = {
			...artifact("knowledge", knowledge),
			payload: { ...knowledge, body: "Edited after hashing." },
		};
		expect(parseArtifact(pipelineArtifactKinds, value)).toMatchObject({
			ok: false,
			reason: "content_hash",
		});
	});

	test("key order does not change the content hash", () => {
		expect(artifactContentHash("knowledge", 1, { title: "a", body: "b" })).toBe(
			artifactContentHash("knowledge", 1, { body: "b", title: "a" }),
		);
	});
});

describe("artifact kind registry (1.2)", () => {
	test("covers the canonical kinds, the boundary kinds, and slides and posts", () => {
		expect([...pipelineArtifactKinds.kinds].sort()).toEqual([
			"approved_plan",
			"blocker_acknowledgements",
			"generation_batch",
			"knowledge",
			"media",
			"post_thread",
			"research_bundle",
			"slide_deck",
			"story_plan",
			"storyboard_table",
			"style_bible",
			"timeline_document",
		]);
	});

	test("a payload validated against the wrong kind is rejected", () => {
		expect(parseArtifact(pipelineArtifactKinds, artifact("media", knowledge))).toMatchObject({
			ok: false,
			reason: "payload",
		});
	});

	test("an unknown kind is rejected", () => {
		expect(parseArtifact(pipelineArtifactKinds, artifact("mystery", knowledge))).toMatchObject({
			ok: false,
			reason: "unknown_kind",
		});
	});

	test("a schema version the kind does not have is rejected", () => {
		expect(
			parseArtifact(pipelineArtifactKinds, artifact("knowledge", knowledge, { schemaVersion: 2 })),
		).toMatchObject({ ok: false, reason: "schema_version" });
	});

	test("adding a kind is a new entry, not an edit to an existing kind", () => {
		const caption = defineArtifactKind({
			kind: "caption_track",
			schemaVersion: 1,
			payload: z.object({ words: z.array(z.string()) }),
			isReady: () => true,
		});
		const extended = createArtifactKindRegistry([...PIPELINE_ARTIFACT_KINDS, caption]);
		expect(parseArtifact(extended, artifact("caption_track", { words: ["hi"] })).ok).toBe(true);
		expect(extended.get("knowledge")).toBe(pipelineArtifactKinds.get("knowledge"));
	});

	test("a kind registered twice fails at registration", () => {
		expect(() =>
			createArtifactKindRegistry([...PIPELINE_ARTIFACT_KINDS, PIPELINE_ARTIFACT_KINDS[0]!]),
		).toThrow(ArtifactKindRegistrationError);
	});
});

describe("artifact references (1.3)", () => {
	test("a reference resolves to the exact content it was taken from", () => {
		const original = artifact("knowledge", knowledge);
		expect(resolveArtifactRef(artifactRefOf(original), () => original)).toEqual({
			ok: true,
			artifact: original,
		});
	});

	test("a reference to a revised artifact is refused, not resolved to the new content", () => {
		const original = artifact("knowledge", knowledge);
		const ref = artifactRefOf(original);
		const revisedPayload = { ...knowledge, body: "Workers are female; drones are male." };
		const revised = artifact("knowledge", revisedPayload, { revision: 2 });
		expect(resolveArtifactRef(ref, () => revised)).toMatchObject({ ok: false, reason: "stale" });
	});

	test("a missing artifact is refused", () => {
		expect(
			resolveArtifactRef(artifactRefOf(artifact("knowledge", knowledge)), () => undefined),
		).toMatchObject({ ok: false, reason: "missing" });
	});

	test("a reference to a different kind is refused", () => {
		const ref = artifactRefOf(artifact("knowledge", knowledge));
		expect(
			resolveArtifactRef(ref, () => artifact("media", { mediaType: "image", url: "/a.png" })),
		).toMatchObject({ ok: false, reason: "kind" });
	});
});

describe("stage result (1.4)", () => {
	test("each variant carries only its own fields", () => {
		const done: StageResult = { status: "completed", outputs: [] };
		const failed: StageResult = {
			status: "failed",
			error: { code: "provider_unavailable", message: "down", retryable: true },
		};
		// @ts-expect-error a completed result cannot carry an error
		const completedWithError: StageResult = {
			status: "completed",
			outputs: [],
			error: { code: "x", message: "x", retryable: false },
		};
		// @ts-expect-error a failed result cannot carry outputs
		const failedWithOutputs: StageResult = {
			status: "failed",
			error: { code: "x", message: "x", retryable: false },
			outputs: [],
		};
		// @ts-expect-error a draft awaiting approval must carry the draft
		const awaitingWithoutDraft: StageResult = { status: "awaiting_approval" };
		expect([
			done.status,
			failed.status,
			completedWithError.status,
			failedWithOutputs.status,
			awaitingWithoutDraft.status,
		]).toEqual(["completed", "failed", "completed", "failed", "awaiting_approval"]);
	});
});

describe("readiness (1.5)", () => {
	const batch = (statuses: Array<"queued" | "running" | "ready" | "failed">) => ({
		items: statuses.map((status, index) => ({
			sectionId: `sec-${index}`,
			asset: "frame" as const,
			status,
		})),
	});

	test("a generation batch that validates but is still running is not ready", () => {
		const running = artifact("generation_batch", batch(["ready", "running"]));
		expect(parseArtifact(pipelineArtifactKinds, running).ok).toBe(true);
		expect(isArtifactReady(pipelineArtifactKinds, running)).toBe(false);
	});

	test("a generation batch with no queued or running item is ready", () => {
		expect(
			isArtifactReady(
				pipelineArtifactKinds,
				artifact("generation_batch", batch(["ready", "failed"])),
			),
		).toBe(true);
	});

	test("an in-progress artifact is not ready even when its payload is final", () => {
		expect(
			isArtifactReady(
				pipelineArtifactKinds,
				artifact("knowledge", knowledge, { status: "in_progress" }),
			),
		).toBe(false);
	});

	test("a failed artifact is never ready", () => {
		expect(
			isArtifactReady(
				pipelineArtifactKinds,
				artifact("knowledge", knowledge, { status: "failed" }),
			),
		).toBe(false);
	});
});

describe("the single write path (2.0)", () => {
	const deps = {
		now: () => "2026-09-29T00:00:00.000Z",
		newId: (() => {
			let n = 0;
			return () => `id-${++n}`;
		})(),
	};
	const editor = { type: "editor" } as const;
	const plan = (narration: string) => ({
		targetSec: 30,
		sections: [{ id: "sec-1", title: "One", narration, visualPrompt: "v" }],
	});

	test("a written artifact parses back, hash and all", () => {
		const { artifact } = writeArtifact(
			pipelineArtifactKinds,
			[],
			{ kind: "knowledge", payload: knowledge, producer: editor, projectId: "p" },
			deps,
		);
		expect(parseArtifact(pipelineArtifactKinds, JSON.parse(JSON.stringify(artifact)))).toEqual({
			ok: true,
			artifact,
		});
	});

	test("rewriting a singleton advances its revision and re-hashes", () => {
		const first = writeArtifact(
			pipelineArtifactKinds,
			[],
			{
				kind: "story_plan",
				payload: plan("before"),
				producer: { type: "stage", stage: "plan", runId: "r" },
				projectId: "p",
			},
			deps,
		);
		const second = writeArtifact(
			pipelineArtifactKinds,
			first.artifacts,
			{ kind: "story_plan", payload: plan("after"), producer: editor, projectId: "p" },
			deps,
		);
		expect(second.artifacts).toHaveLength(1);
		expect(second.artifact.id).toBe(first.artifact.id);
		expect(second.artifact.revision).toBe(2);
		expect(second.artifact.contentHash).not.toBe(first.artifact.contentHash);
		expect(first.artifacts[0]!.revision).toBe(1);
	});

	test("a non-singleton kind appends", () => {
		const first = writeArtifact(
			pipelineArtifactKinds,
			[],
			{ kind: "knowledge", payload: knowledge, producer: editor, projectId: "p" },
			deps,
		);
		const second = writeArtifact(
			pipelineArtifactKinds,
			first.artifacts,
			{ kind: "knowledge", payload: knowledge, producer: editor, projectId: "p" },
			deps,
		);
		expect(second.artifacts.map((a) => a.revision)).toEqual([1, 1]);
	});

	test("an invalid payload or a run-bound producer without a run is refused", () => {
		expect(() =>
			writeArtifact(
				pipelineArtifactKinds,
				[],
				{ kind: "media", payload: knowledge, producer: editor, projectId: "p" },
				deps,
			),
		).toThrow(ArtifactWriteError);
		const noRun = { type: "tool", tool: "generate_voice" } as unknown as { type: "editor" };
		expect(() =>
			writeArtifact(
				pipelineArtifactKinds,
				[],
				{ kind: "knowledge", payload: knowledge, producer: noRun, projectId: "p" },
				deps,
			),
		).toThrow(ArtifactWriteError);
	});

	test("artifactsOfKind narrows to that kind's payload", () => {
		const list = writeArtifact(
			pipelineArtifactKinds,
			writeArtifact(
				pipelineArtifactKinds,
				[],
				{ kind: "knowledge", payload: knowledge, producer: editor, projectId: "p" },
				deps,
			).artifacts,
			{ kind: "story_plan", payload: plan("x"), producer: editor, projectId: "p" },
			deps,
		).artifacts;
		expect(artifactsOfKind(list, storyPlanArtifact).map((a) => a.payload.targetSec)).toEqual([30]);
		expect(artifactsOfKind(list, knowledgeArtifact).map((a) => a.payload.title)).toEqual(["Bees"]);
	});
});
