import { describe, expect, test } from "bun:test";
import { storyInputsOf } from "../story-inputs.ts";
import { fixtureArtifacts, rewritePlan } from "../artifact-fixtures.ts";
import { canonicalizeLegacyStoryPlan, type StoryboardCommand } from "@maleo/shared";
import type { AgentJob } from "../model.ts";
import { getStoryPlan } from "../plan-state.ts";
import {
	ensureStoryboardGenerationState,
	executeStoryboardCommand,
} from "./storyboard-command-service.ts";
import { approveCurrentStoryPlan } from "./storyboard-command-service.ts";
import { generateStoryAssetsFlow } from "./story-assets.ts";
import { updateSectionFlow } from "./planning.ts";
import { directionOptionsFor } from "./storyboard-command-service.ts";
import { createContentProject } from "@maleo/db/project-detail";
import { addProjectReference, upsertReferenceEntity } from "@maleo/db/references";

/** Unwrap an approval that the test expects to succeed. */
function approvedState(outcome: Awaited<ReturnType<typeof approveCurrentStoryPlan>>) {
	if (!outcome.ok) throw new Error(`approval refused: ${outcome.message}`);
	return outcome.state;
}

function job(): AgentJob {
	const sections = [
		{
			id: "beat-a",
			sectionId: "section-a",
			semanticBeatId: "beat-a",
			title: "A",
			narration: "One",
			visualPrompt: "One",
			visualPrompts: ["Old shot"],
			shotCues: ["One"],
			factual: true,
			sourceUrls: ["https://example.test"],
			sourceEvidence: [
				{ url: "https://example.test", quote: "A sufficiently long source quote for the fixture." },
			],
			citationStatus: "verified" as const,
			estimatedDurationSec: 1,
			status: "ready" as const,
			audioUrl: "one.wav",
			imageUrl: "one.png",
		},
		{
			id: "beat-b",
			sectionId: "section-b",
			semanticBeatId: "beat-b",
			title: "B",
			narration: "Two",
			visualPrompt: "Two",
			estimatedDurationSec: 1,
			status: "ready" as const,
			audioUrl: "two.wav",
			imageUrl: "two.png",
		},
	];
	return {
		id: "job",
		projectId: "project",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: fixtureArtifacts("project", [
			{
				kind: "story_plan",
				payload: {
					targetSec: 10,
					sections,
					generationState: canonicalizeLegacyStoryPlan(
						sections,
						(() => {
							let i = 0;
							return () => `id-${++i}`;
						})(),
					),
				},
			},
		]),
		aspect: "9:16",
		brief: "brief",
		startedAt: 0,
	};
}

async function directedJob(extraBeat = false): Promise<AgentJob> {
	const current = job();
	if (extraBeat) {
		const state = getStoryPlan(current)!.generationState!;
		await executeStoryboardCommand(
			current,
			state.draft.revisionId,
			{
				type: "add_beat",
				sectionId: "section-a",
				afterBeatId: "beat-a",
				beat: { id: "beat-a2", title: "A2", narration: "More", visualPrompt: "More" },
			},
			{ newRevisionId: "extra", save: () => {} },
		);
	}
	rewritePlan(current, (plan) => {
		const sections = plan.sections.map((section, index) => ({
			...section,
			editorial: {
				purpose: index ? ("reveal" as const) : ("establish" as const),
				presentation: "narrative" as const,
				visualConcept: `Concept ${index}`,
				noveltyKey: `novel-${index}`,
				sfxCue: null,
				shots: [
					{
						index: 0,
						visualIntent: `Shot ${index}`,
						role: "continuity" as const,
						bindings: [],
						rationale: "Reason",
					},
				],
			},
		}));
		const state = plan.generationState!;
		return {
			...plan,
			referenceAliases: [],
			directionFingerprint: "fingerprint",
			directionInputs: {
				materials: JSON.stringify({ visual: "", rules: "" }),
				templateConstraints: "{}",
			},
			plannedReferences: [
				{
					key: "planned-one",
					role: "character",
					label: "One",
					description: "Subject one",
					status: "planned",
				},
			],
			sections,
			generationState: {
				...state,
				draft: {
					...state.draft,
					sections: state.draft.sections.map((section) => ({
						...section,
						beats: section.beats.map((beat) => ({
							...beat,
							editorial: sections.find((item) => item.semanticBeatId === beat.id)?.editorial,
						})),
					})),
				},
			},
		};
	});
	return current;
}

describe("storyboard command service", () => {
	test("directed-plan mutations preserve titles and locks but stale content and structure", async () => {
		const stableCommands: StoryboardCommand[] = [
			{ type: "update_section", sectionId: "section-a", fields: { title: "Renamed" } },
			{ type: "lock_beat", beatId: "beat-a" },
			{ type: "unlock_beat", beatId: "beat-a" },
		];
		for (const command of stableCommands) {
			const current = await directedJob();
			const revision = getStoryPlan(current)!.generationState!.draft.revisionId;
			const result = await executeStoryboardCommand(current, revision, command, { save: () => {} });
			if (!result.ok) throw new Error(`${command.type}: ${result.message}`);
			expect(getStoryPlan(current)!.needsDirection).toBeUndefined();
		}

		const commands: Array<{ command: StoryboardCommand; extra?: boolean }> = [
			{ command: { type: "update_beat", beatId: "beat-a", fields: { narration: "Changed" } } },
			{
				command: {
					type: "add_section",
					afterSectionId: "section-a",
					section: {
						id: "section-c",
						title: "C",
						beats: [{ id: "beat-c", title: "C", narration: "C", visualPrompt: "C" }],
					},
				},
			},
			{ command: { type: "remove_section", sectionId: "section-b" } },
			{ command: { type: "reorder_section", sectionId: "section-b", afterSectionId: null } },
			{
				command: {
					type: "add_beat",
					sectionId: "section-a",
					afterBeatId: "beat-a",
					beat: { id: "beat-new", title: "N", narration: "N", visualPrompt: "N" },
				},
			},
			{ command: { type: "remove_beat", beatId: "beat-a2" }, extra: true },
			{
				command: {
					type: "reorder_beat",
					beatId: "beat-a2",
					sectionId: "section-a",
					afterBeatId: null,
				},
				extra: true,
			},
			{
				command: {
					type: "split_beat",
					beatId: "beat-a",
					first: { narration: "First" },
					second: { id: "beat-split", title: "Split", narration: "Second", visualPrompt: "Second" },
				},
			},
			{
				command: { type: "merge_beats", firstBeatId: "beat-a", secondBeatId: "beat-a2" },
				extra: true,
			},
			{
				command: {
					type: "attach_reference",
					beatId: "beat-a",
					referenceKind: "planned",
					referenceId: "planned-one",
				},
			},
		];
		for (const { command, extra } of commands) {
			const current = await directedJob(extra);
			const revision = getStoryPlan(current)!.generationState!.draft.revisionId;
			const result = await executeStoryboardCommand(current, revision, command, { save: () => {} });
			if (!result.ok) throw new Error(`${command.type}: ${result.message}`);
			expect(getStoryPlan(current)!.needsDirection).toBe(true);
			expect(getStoryPlan(current)!.directionErrors?.[0]).toContain("stale_direction");
		}
	});

	test("directed plans refuse binding injection and off-roster attach without revision", async () => {
		const injected = await directedJob();
		const revision = getStoryPlan(injected)!.generationState!.draft.revisionId;
		const result = await executeStoryboardCommand(
			injected,
			revision,
			{
				type: "update_beat",
				beatId: "beat-a",
				fields: {
					editorial: {
						purpose: "establish",
						presentation: "narrative",
						visualConcept: "Injected",
						noveltyKey: "injected",
						sfxCue: null,
						shots: [
							{
								index: 0,
								visualIntent: "Injected",
								role: "continuity",
								bindings: [{ entityId: "outside" }],
								rationale: "Injected",
							},
						],
					},
				},
			},
			{ save: () => {} },
		);
		expect(result).toMatchObject({ ok: false, reason: "invalid", currentRevisionId: revision });

		const attached = await directedJob();
		const attachRevision = getStoryPlan(attached)!.generationState!.draft.revisionId;
		const offRoster = await executeStoryboardCommand(
			attached,
			attachRevision,
			{
				type: "attach_reference",
				beatId: "beat-a",
				referenceKind: "entity",
				referenceId: "outside",
			},
			{ save: () => {} },
		);
		expect(offRoster).toMatchObject({
			ok: false,
			reason: "invalid",
			currentRevisionId: attachRevision,
		});
		expect(getStoryPlan(attached)!.generationState!.draft.revisionId).toBe(attachRevision);
	});
	test("approval defaults to review, reapproval replaces snapshot, and draft edits do not mutate it", async () => {
		const current = job();
		const first = approvedState(await approveCurrentStoryPlan(current, "explicit"));
		expect(first.approvedSnapshot).toMatchObject({
			approvalMode: "explicit",
			extensionPolicy: "review_additions",
		});
		const beatId = first.draft.sections[0]!.beats[0]!.id;
		await executeStoryboardCommand(
			current,
			first.draft.revisionId,
			{ type: "update_beat", beatId, fields: { narration: "Later" } },
			{ newRevisionId: "later", save: () => {} },
		);
		expect(
			getStoryPlan(current)!.generationState!.approvedSnapshot!.sections[0]!.beats[0]!.narration,
		).toBe("One");
		const second = approvedState(
			await approveCurrentStoryPlan(current, "explicit", "auto_approve_additions"),
		);
		expect(second.approvedSnapshot).toMatchObject({
			revisionId: "later",
			extensionPolicy: "auto_approve_additions",
		});
	});

	test("normal generation without approved snapshot starts no work", async () => {
		const current = job();
		const result = await generateStoryAssetsFlow(
			current,
			storyInputsOf(current, ["approved", "research"]),
		);
		expect(result.note).toMatch(/not approved/i);
		expect(current.events.some((event) => event.kind === "asset_created")).toBe(false);
	});
	test("direction failure blocks approval until revision-checked edits repair every beat", async () => {
		const current = job();
		rewritePlan(current, (plan) => ({ ...plan, needsDirection: true }));
		expect((await approveCurrentStoryPlan(current, "explicit")).ok).toBe(false);
		const firstRevision = getStoryPlan(current)!.generationState!.draft.revisionId;
		const first = await executeStoryboardCommand(
			current,
			firstRevision,
			{
				type: "update_beat",
				beatId: "beat-a",
				fields: {
					editorial: {
						purpose: "establish",
						presentation: "narrative",
						visualConcept: "door opens",
						noveltyKey: "door",
						sfxCue: null,
					},
				},
			},
			{ newRevisionId: "directed-a", save: () => {} },
		);
		expect(first.ok).toBe(true);
		expect(getStoryPlan(current)!.needsDirection).toBe(true);
		const second = await executeStoryboardCommand(
			current,
			"directed-a",
			{
				type: "update_beat",
				beatId: "beat-b",
				fields: {
					editorial: {
						purpose: "reveal",
						presentation: "headline",
						visualConcept: "mechanism cutaway",
						noveltyKey: "cutaway",
						sfxCue: "latch snap",
					},
				},
			},
			{ newRevisionId: "directed-b", save: () => {} },
		);
		expect(second.ok).toBe(true);
		expect(getStoryPlan(current)!.needsDirection).toBe(false);
		expect((await approveCurrentStoryPlan(current, "explicit")).ok).toBe(true);
	});
	test("a refused approval reports its cause and leaves the plan's recorded direction errors intact", async () => {
		const current = job();
		rewritePlan(current, (plan) => ({
			...plan,
			needsDirection: true,
			directionErrors: ["beat-a: shot 1 requires a product with no roster entity"],
		}));
		const refused = await approveCurrentStoryPlan(current, "explicit");
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error("expected refusal");
		expect(refused.message).toContain("no roster entity");
		// The refusal travels back to the caller; it is not written onto the plan,
		// so the original cause survives and nothing latches.
		expect(getStoryPlan(current)!.directionErrors).toEqual([
			"beat-a: shot 1 requires a product with no roster entity",
		]);
	});
	test("persists one stable-id mutation and leaves unrelated section byte-equivalent", async () => {
		const current = job();
		current.scenes = [
			{
				name: "Existing",
				durationSec: 2,
				shot: "Wide",
				move: "Static",
				transition: "cut",
				visual: "old",
				voiceover: "old",
			},
		];
		const timelineBefore = JSON.stringify(current.scenes);
		const before = JSON.stringify(getStoryPlan(current)!.sections[1]);
		const state = getStoryPlan(current)!.generationState!;
		let saves = 0;
		const result = await executeStoryboardCommand(
			current,
			state.draft.revisionId,
			{
				type: "update_beat",
				beatId: "beat-a",
				fields: { narration: "Changed words", visualPrompt: "Changed visual" },
			},
			{
				newRevisionId: "rev-2",
				save: () => {
					saves++;
				},
			},
		);
		expect(result).toMatchObject({ ok: true, state: { draft: { revisionId: "rev-2" } } });
		expect(saves).toBe(1);
		expect(getStoryPlan(current)!.sections[0]).toMatchObject({
			narration: "Changed words",
			visualPrompt: "Changed visual",
			visualPrompts: ["Changed visual"],
			sourceUrls: [],
			sourceEvidence: [],
			citationStatus: "unsupported",
			audioUrl: "one.wav",
			imageUrl: "one.png",
			status: "ready",
		});
		expect(getStoryPlan(current)!.sections[0]!.shotCues).toBeUndefined();
		expect(getStoryPlan(current)!.generationState!.draft.sections[0]!.beats[0]).toMatchObject({
			narration: "Changed words",
			visualPrompt: "Changed visual",
		});
		expect(JSON.stringify(getStoryPlan(current)!.sections[1])).toBe(before);
		expect(JSON.stringify(current.scenes)).toBe(timelineBefore);
	});

	test("projects every semantic beat without losing chapter identity", async () => {
		const current = job();
		const state = getStoryPlan(current)!.generationState!;
		const result = await executeStoryboardCommand(
			current,
			state.draft.revisionId,
			{
				type: "add_beat",
				sectionId: "section-a",
				afterBeatId: "beat-a",
				beat: { id: "beat-a2", title: "A2", narration: "More", visualPrompt: "More" },
			},
			{ newRevisionId: "rev-2", save: () => {} },
		);
		expect(result.ok).toBe(true);
		const projected = getStoryPlan(current)!.sections.slice(0, 2);
		expect(new Set(projected.map((section) => section.id)).size).toBe(2);
		expect(
			projected.map((section) => [
				section.id,
				section.sectionId,
				section.semanticBeatId,
				section.narration,
			]),
		).toEqual([
			["beat-a", "section-a", "beat-a", "One"],
			["beat-a2", "section-a", "beat-a2", "More"],
		]);
	});

	test("canonicalizes a legacy plan once before its first command", async () => {
		const current = job();
		rewritePlan(current, (plan) => ({ ...plan, generationState: undefined }));
		const state = ensureStoryboardGenerationState(current)!;
		const beatId = state.draft.sections[0]!.beats[0]!.id;
		const result = await executeStoryboardCommand(
			current,
			state.draft.revisionId,
			{ type: "update_beat", beatId, fields: { narration: "Legacy changed" } },
			{ newRevisionId: "legacy-edited", save: () => {} },
		);
		expect(result).toMatchObject({ ok: true, state: { draft: { revisionId: "legacy-edited" } } });
		expect(getStoryPlan(current)!.sections[0]).toMatchObject({
			id: beatId,
			sectionId: "section-a",
			semanticBeatId: beatId,
			narration: "Legacy changed",
		});
	});

	test("update_section canonicalizes a legacy plan without reminting a conflicting revision", async () => {
		const current = job();
		rewritePlan(current, (plan) => ({ ...plan, generationState: undefined }));
		const result = await updateSectionFlow(
			current,
			{ sectionId: "section-a", narration: "Legacy updated" },
			storyInputsOf(current),
			() => {},
		);
		expect(result.note).toMatch(/^Updated section 1/);
		expect(getStoryPlan(current)!.sections[0]!.narration).toBe("Legacy updated");
		expect(getStoryPlan(current)!.generationState!.draft.sections[0]!.beats[0]!.narration).toBe(
			"Legacy updated",
		);
	});

	test("legacy approval canonicalizes before generation authority is frozen", async () => {
		const current = job();
		rewritePlan(current, (plan) => ({ ...plan, generationState: undefined }));
		const state = approvedState(await approveCurrentStoryPlan(current, "explicit"));
		expect(state.approvedSnapshot).toMatchObject({
			revisionId: state.draft.revisionId,
			approvalMode: "explicit",
			extensionPolicy: "review_additions",
		});
		expect(
			getStoryPlan(current)!.sections.every(
				(section) => section.sectionId && section.semanticBeatId,
			),
		).toBe(true);
	});

	test("rejects invalid, locked, and stale commands without save", async () => {
		const current = job();
		const revision = getStoryPlan(current)!.generationState!.draft.revisionId;
		let saves = 0;
		const save = () => {
			saves++;
		};
		expect(
			await executeStoryboardCommand(
				current,
				revision,
				{ type: "update_beat", beatId: "missing", fields: { narration: "No" } },
				{ save },
			),
		).toMatchObject({ ok: false, reason: "invalid" });
		const locked = await executeStoryboardCommand(
			current,
			revision,
			{ type: "lock_beat", beatId: "beat-a" },
			{ newRevisionId: "locked", save },
		);
		expect(locked.ok).toBe(true);
		expect(
			await executeStoryboardCommand(
				current,
				"locked",
				{ type: "update_beat", beatId: "beat-a", fields: { narration: "No" } },
				{ save },
			),
		).toMatchObject({ ok: false, reason: "locked" });
		expect(
			await executeStoryboardCommand(
				current,
				revision,
				{ type: "unlock_beat", beatId: "beat-a" },
				{ save },
			),
		).toMatchObject({ ok: false, reason: "conflict", currentRevisionId: "locked" });
		expect(saves).toBe(1);
	});

	test("runtime validation rejects malformed command", async () => {
		const current = job();
		const revision = getStoryPlan(current)!.generationState!.draft.revisionId;
		const malformed = {
			type: "update_beat",
			beatId: "beat-a",
			fields: { unknown: true },
		} as unknown as StoryboardCommand;
		expect(
			await executeStoryboardCommand(current, revision, malformed, {
				save: () => {
					throw new Error("must not save");
				},
			}),
		).toMatchObject({ ok: false, reason: "invalid" });
	});
});

/* Direction may only offer what generation can actually attach. A style plate or
 * an entity with no canonical image is on `project_reference` but is not castable,
 * and binding one would pass review and then fail the section as detached. */
describe("the direction roster is the castable roster", () => {
	test("style plates and imageless entities never reach direction", async () => {
		const projectId = (await createContentProject({ title: "Roster", type: "video" })).project.id;
		const add = async (role: string, label: string, image: string | null) => {
			const entity = (await upsertReferenceEntity({
				id: `ref-${label}`,
				workspace: "default",
				role,
				label,
				description: `${label} ref`,
				canonical_image_url: image,
			}))!;
			await addProjectReference({ project_id: projectId, entity_id: entity.id });
			return entity;
		};
		const character = await add("character", "Bee", "/api/image-gen/files/bee.png");
		const style = await add("style", "Plate", "/api/image-gen/files/plate.png");
		const imageless = await add("character", "Ghost", null);
		const roster = (await directionOptionsFor({ projectId } as never)).roster.map(
			(entry) => entry.id,
		);
		expect(roster).toContain(character.id);
		expect(roster).not.toContain(style.id);
		expect(roster).not.toContain(imageless.id);
	});
});
