import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fixtureArtifacts } from "../../modules/agents/core/artifact-fixtures.ts";
import {
	approvedPlanArtifact,
	artifactRefOf,
	artifactsOfKind,
	documentArtifacts,
	storyPlanArtifactOf,
} from "@maleo/shared";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { addProjectReference, upsertReferenceEntity } from "@maleo/db/references";
import { canonicalizeLegacyStoryPlan, readStoryboardDocument } from "@maleo/shared";
import { registerStoryboardRoutes } from "./storyboards.ts";
import { setStorySequenceDirectorForTests } from "../../lib/story/creative-director.ts";

const dbPath = join(tmpdir(), "maleo-storyboard-authoring.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const json = { "content-type": "application/json" };

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});
afterEach(async () => {
	setStorySequenceDirectorForTests(null);
	await resetDb();
	if (priorDbPath === undefined) process.env.MALEO_DB_PATH = "";
	else process.env.MALEO_DB_PATH = priorDbPath;
});

function app(): Hono {
	const instance = new Hono();
	registerStoryboardRoutes(instance);
	return instance;
}

function authoredSection(narration = "Original") {
	return {
		id: "beat-a",
		sectionId: "section-a",
		semanticBeatId: "beat-a",
		title: "Opening",
		narration,
		visualPrompt: "Wide shot",
		estimatedDurationSec: 3,
	};
}

function section(narration = "Original") {
	return {
		...authoredSection(narration),
		status: "ready" as const,
		imageUrls: ["generated.png"],
		imageSourceRevisionIds: ["rev-a"],
		voiceSegments: [
			{
				id: "voice-a",
				narration,
				audioUrl: "generated.wav",
				audioDurationSec: 3,
				sourceBeatId: "beat-a",
				sourceRevisionId: "rev-a",
			},
		],
	};
}

async function seed(legacy = false, plan: Record<string, unknown> = {}): Promise<string> {
	const id = (
		await createContentProject({ title: "Storyboard", type: "video", target_duration_sec: 60 })
	).project.id;
	const sections = [section()];
	await addContentStoryboard({
		project_id: id,
		status: "storyboard",
		storyboard_json: {
			schemaVersion: 2,
			clips: [{ id: "clip-a", type: "image", startSec: 0, durationSec: 3, track: 0 }],
			markers: [],
			presentation: { aspectRatio: "16:9" },
			artifacts: fixtureArtifacts(id, [
				{
					kind: "story_plan",
					payload: {
						targetSec: 60,
						sections,
						...plan,
						...(legacy
							? {}
							: {
									generationState:
										plan.generationState ??
										canonicalizeLegacyStoryPlan(
											[authoredSection()],
											(() => {
												const ids = ["plan-a", "rev-a"];
												return () => ids.shift()!;
											})(),
										),
								}),
					},
				},
			]),
		},
	});
	return id;
}

describe("storyboard authoring routes", () => {
	test("first add-section command creates plan for empty project", async () => {
		const id = (
			await createContentProject({ title: "Empty", type: "video", target_duration_sec: 45 })
		).project.id;
		const res = await app().request(`/projects/${id}/storyboard-authoring/commands`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				expectedRevisionId: "missing",
				command: {
					type: "add_section",
					section: {
						id: "section-first",
						title: "Opening",
						beats: [
							{ id: "beat-first", title: "Hook", narration: "Start here", visualPrompt: "Wide" },
						],
					},
				},
			}),
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			ok: true,
			state: { draft: { sections: [{ id: "section-first", beats: [{ id: "beat-first" }] }] } },
		});
	});

	test("read returns current draft without writing", async () => {
		const id = await seed();
		const res = await app().request(`/projects/${id}/storyboard-authoring`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			legacy: false,
			state: {
				planId: "plan-a",
				draft: { revisionId: "rev-a", sections: [{ beats: [{ id: "beat-a" }] }] },
			},
			generatedByBeatId: {
				"beat-a": [
					{ imageUrls: ["generated.png"], voiceSegments: [{ audioUrl: "generated.wav" }] },
				],
			},
		});
		expect(body.state.draft.sections[0].beats[0].imageUrls).toBeUndefined();
		expect((await getContentProject(id))!.storyboards).toHaveLength(1);
	});

	test("read round-trips directed bindings with resolved display metadata", async () => {
		const generationState = canonicalizeLegacyStoryPlan(
			[authoredSection()],
			(() => {
				const ids = ["plan-directed", "rev-directed"];
				return () => ids.shift()!;
			})(),
		);
		generationState.draft.sections[0]!.beats[0]!.editorial = {
			purpose: "establish",
			presentation: "headline",
			visualConcept: "Threshold reveal",
			noveltyKey: "threshold",
			sfxCue: null,
			shots: [
				{
					index: 0,
					visualIntent: "Mara opens the archive",
					role: "continuity",
					bindings: [{ entityId: "hero" }, { plannedKey: "archive" }],
					rationale: "Carries both identities.",
				},
			],
		};
		const id = await seed(false, {
			generationState,
			plannedReferences: [
				{
					key: "archive",
					role: "location",
					label: "Archive",
					description: "Stone archive",
					status: "planned",
				},
			],
			referenceAliases: [
				{ ref: "entity:hero", aliases: ["Mara"] },
				{ ref: "planned:archive", aliases: ["archive"] },
			],
		});
		await upsertReferenceEntity({
			id: "hero",
			workspace: (await getContentProject(id))!.project.workspace,
			role: "character",
			label: "Mara",
			description: "Lead archivist",
			canonical_image_url: "/api/image-gen/files/hero.png",
		});
		await addProjectReference({ project_id: id, entity_id: "hero" });

		const body = await (await app().request(`/projects/${id}/storyboard-authoring`)).json();

		expect(body.state.draft.sections[0].beats[0].editorial.shots[0].bindings).toEqual([
			{ entityId: "hero" },
			{ plannedKey: "archive" },
		]);
		expect(body.references).toMatchObject({
			"entity:hero": { label: "Mara", role: "character", source: "existing" },
			"planned:archive": { label: "Archive", role: "location", source: "planned" },
		});
	});

	test("current command writes one version and preserves unrelated document fields", async () => {
		const id = await seed();
		const res = await app().request(`/projects/${id}/storyboard-authoring/commands`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				expectedRevisionId: "rev-a",
				command: { type: "update_beat", beatId: "beat-a", fields: { narration: "Changed" } },
			}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body).toMatchObject({
			ok: true,
			legacy: false,
			state: { draft: { sections: [{ beats: [{ narration: "Changed" }] }] } },
			generatedByBeatId: {
				"beat-a": [
					{ imageUrls: ["generated.png"], voiceSegments: [{ audioUrl: "generated.wav" }] },
				],
			},
		});
		const detail = (await getContentProject(id))!;
		expect(detail.storyboards[0]?.version).toBe(2);
		const doc = readStoryboardDocument(detail.storyboards[0]!.storyboard_json).doc;
		expect(doc.clips).toHaveLength(1);
		expect(doc.presentation).toEqual({ aspectRatio: "16:9" });
	});

	test("stale command returns current state without writing", async () => {
		const id = await seed();
		const res = await app().request(`/projects/${id}/storyboard-authoring/commands`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				expectedRevisionId: "old",
				command: { type: "lock_beat", beatId: "beat-a" },
			}),
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({
			ok: false,
			reason: "conflict",
			state: { draft: { revisionId: "rev-a" } },
		});
		expect((await getContentProject(id))!.storyboards).toHaveLength(1);
	});

	test("legacy plan canonicalizes on first mutation, not read", async () => {
		const id = await seed(true);
		const read = await app().request(`/projects/${id}/storyboard-authoring`);
		expect(await read.json()).toMatchObject({
			legacy: true,
			state: { draft: { revisionId: "legacy-unpersisted" } },
			generatedByBeatId: { "legacy-beat-0": [{ imageUrls: ["generated.png"] }] },
		});
		expect((await getContentProject(id))!.storyboards).toHaveLength(1);

		const res = await app().request(`/projects/${id}/storyboard-authoring/commands`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({
				expectedRevisionId: "legacy-unpersisted",
				command: {
					type: "update_beat",
					beatId: "legacy-beat-0",
					fields: { narration: "Canonical" },
				},
			}),
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			ok: true,
			legacy: false,
			state: { draft: { sections: [{ beats: [{ narration: "Canonical" }] }] } },
		});
		expect((await getContentProject(id))!.storyboards[0]?.version).toBe(2);
	});

	test("approval records both explicit extension policies", async () => {
		const id = await seed();
		for (const extensionPolicy of ["review_additions", "auto_approve_additions"] as const) {
			const res = await app().request(`/projects/${id}/storyboard-authoring/approve`, {
				method: "POST",
				headers: json,
				body: JSON.stringify({ expectedRevisionId: "rev-a", extensionPolicy }),
			});
			expect(res.status).toBe(201);
			expect(await res.json()).toMatchObject({
				ok: true,
				state: {
					approvedSnapshot: { revisionId: "rev-a", approvalMode: "explicit", extensionPolicy },
				},
			});
		}
		// The editor's approval is recorded as the artifact generation consumes,
		// produced by the editor and referencing the plan revision it froze.
		const artifacts = documentArtifacts(
			readStoryboardDocument((await getContentProject(id))!.storyboards[0]!.storyboard_json).doc
				.artifacts,
		);
		const approved = artifactsOfKind(artifacts, approvedPlanArtifact)[0]!;
		expect(approved.payload).toMatchObject({
			revisionId: "rev-a",
			extensionPolicy: "auto_approve_additions",
		});
		expect(approved.producer).toEqual({ type: "editor" });
		expect(approved.inputRefs).toEqual([artifactRefOf(storyPlanArtifactOf(artifacts)!)]);
	});

	test("approval refuses a plan that needs direction and writes nothing", async () => {
		const id = await seed(false, {
			needsDirection: true,
			directionErrors: [
				"repeated_treatment: beat-a/beat-b: adjacent presentation and novelty repeat",
			],
		});
		const res = await app().request(`/projects/${id}/storyboard-authoring/approve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ expectedRevisionId: "rev-a", extensionPolicy: "review_additions" }),
		});
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body).toMatchObject({ ok: false, reason: "invalid" });
		expect(body.message).toContain("repeated_treatment");
		expect(body.state.approvedSnapshot).toBeUndefined();
		expect((await getContentProject(id))!.storyboards[0]?.version).toBe(1);
	});

	test("approval repairs stale directed inputs and then approves", async () => {
		// The editor used to refuse here and offer nothing that could clear it, while
		// the same plan approved from chat — which repairs first. Both repair now.
		let directorCalls = 0;
		setStorySequenceDirectorForTests(async () => {
			directorCalls += 1;
			return {
				plannedReferences: [],
				referenceAliases: [],
				beats: [
					{
						beatId: "beat-a",
						editorial: {
							purpose: "establish",
							presentation: "narrative",
							visualConcept: "A wide opening",
							noveltyKey: "opening",
							sfxCue: null,
							shots: [
								{
									index: 0,
									visualIntent: "Wide shot",
									role: "continuity",
									bindings: [],
									rationale: "Matches the narration.",
								},
							],
						},
					},
				],
			};
		});
		const id = await seed(false, {
			referenceAliases: [],
			directionFingerprint: "stale-fingerprint",
			directionInputs: {
				materials: JSON.stringify({ visual: "", rules: "" }),
				templateConstraints: "{}",
			},
		});
		const res = await app().request(`/projects/${id}/storyboard-authoring/approve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ expectedRevisionId: "rev-a", extensionPolicy: "review_additions" }),
		});
		expect(res.status).toBe(201);
		expect(directorCalls).toBe(1);
		expect(await res.json()).toMatchObject({
			ok: true,
			state: { approvedSnapshot: { revisionId: "rev-a" } },
		});
	});

	test("approval refuses what repair cannot clear and snapshots nothing", async () => {
		let directorCalls = 0;
		setStorySequenceDirectorForTests(async () => {
			directorCalls += 1;
			throw new Error("director must not run for an operator-only blocker");
		});
		const id = await seed(false, {
			referenceAliases: [],
			directionFingerprint: "stale-fingerprint",
			directionInputs: {
				materials: JSON.stringify({ visual: "", rules: "" }),
				templateConstraints: "{}",
			},
			needsDirection: true,
			directionBlocked: true,
			directionErrors: ["beat-a: shot 1 requires a product with no roster entity"],
		});
		const res = await app().request(`/projects/${id}/storyboard-authoring/approve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ expectedRevisionId: "rev-a", extensionPolicy: "review_additions" }),
		});
		expect(res.status).toBe(422);
		expect(directorCalls).toBe(0);
		const refusal = await res.json();
		expect(refusal).toMatchObject({
			ok: false,
			reason: "invalid",
			message: expect.stringContaining("no roster entity"),
		});
		// The refusal arrives as a blocker with its remedy, not as a dead sentence.
		expect(refusal.blockers).toHaveLength(1);
		expect(refusal.blockers[0]).toMatchObject({
			source: "story_direction",
			remedy: { kind: "navigate", target: "references" },
		});
		expect(typeof refusal.blockers[0].id).toBe("string");
		const plan = storyPlanArtifactOf(
			documentArtifacts(
				readStoryboardDocument((await getContentProject(id))!.storyboards[0]!.storyboard_json).doc
					.artifacts,
			),
		)?.payload as { generationState?: { approvedSnapshot?: unknown } };
		expect(plan.generationState?.approvedSnapshot).toBeUndefined();
		expect((await getContentProject(id))!.storyboards[0]?.version).toBe(1);
	});

	test("approval allows direction errors that generation normalizes when data is off", async () => {
		const id = await seed(false, {
			needsDirection: true,
			directionErrors: [
				"invalid_infographic: beat-a: infographic presentation needs structured data",
			],
		});
		const res = await app().request(`/projects/${id}/storyboard-authoring/approve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ expectedRevisionId: "rev-a", extensionPolicy: "review_additions" }),
		});
		expect(res.status).toBe(201);
	});
});
