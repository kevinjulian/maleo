/* The second fixture's data: a project the editor's chat surfaces can populate.
 *
 * `api.har` replays a project with two text clips, no scenes and no chat. That
 * is deliberate and stays that way — see `screens.ts` on why a small project was
 * chosen — but it leaves four surfaces unreachable, and an unreachable surface
 * is one no baseline can watch. The story chat, the run cards, the audit panel
 * and the clip inspector were all extracted from inline styles with
 * nothing able to say whether the pixels moved.
 *
 * Authored, not recorded. `fixture-data.ts` says why for the first fixture and
 * the reasoning is the same here, with one addition: the audit panel reads
 * `/api/operations/projects/:id/trace`, which `api.har` never carried at all, so
 * there was nothing to re-record even in principle. The endpoint's response is
 * written here against the types `audit-panel.tsx` declares.
 *
 * Everything is named so a reviewer looking at a committed screenshot can tell
 * it is fixture data from the image alone.
 */
import { fixtureArtifact } from "./artifacts.ts";

/** The project this fixture replays.
 *
 *  `…0001` is the timeline fixture and `…0002` the image one; this is the third
 *  and last synthetic id. Separate from `…0001` rather than an enrichment of it
 *  because every screen replays whichever fixture it names, and growing the
 *  small one would make every timeline capture pay for scenes it does not show.
 */
export const EDITOR_CHAT_PROJECT_ID = "00000000-0000-4000-8000-000000000003";

/** Fixed so relative timestamps are part of the baseline rather than a reason it
 *  rots. Three hours before the clock `screens.spec.ts` freezes, so the audit
 *  panel's run times read as a session that finished rather than one in flight. */
const T0 = new Date("2026-08-04T06:00:00Z").getTime();
const at = (minutes: number): number => T0 + minutes * 60_000;

/** A flat two-tone SVG as a `data:` URI — the same device `fixture-data.ts`
 *  uses, and for the same reason: the suite replays `**\/api\/**` and nothing
 *  else, so any other scheme reaches a dev-server proxy with no API behind it. */
function fixtureFrame(hue: number, label: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
		`<rect width="320" height="180" fill="hsl(${hue} 42% 58%)"/>` +
		`<rect x="14" y="14" width="292" height="152" fill="none" stroke="hsl(${hue} 42% 88%)" stroke-width="3"/>` +
		`<text x="160" y="102" font-family="monospace" font-size="34" fill="hsl(${hue} 42% 94%)" text-anchor="middle">${label}</text>` +
		`</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FRAME_ONE = fixtureFrame(210, "FIXTURE 1");
const FRAME_TWO = fixtureFrame(150, "FIXTURE 2");
const FRAME_THREE = fixtureFrame(30, "FIXTURE 3");

/* ── The document: three scenes and one text clip ──
 *
 * Three scenes rather than one, because the Studio's scene strip and the chat's
 * script table both render a list and a list of one does not show that it is a
 * list.
 */

interface FixtureScene {
	id: number;
	name: string;
	dur: number;
	vo: string;
	vis: string;
	shot: string;
	move: string;
	src: string;
}

export const SCENES: FixtureScene[] = [
	{
		id: 1,
		name: "Fixture opening",
		dur: 4,
		vo: "A fixture hook establishes the question.",
		vis: "Two-tone fixture title card",
		shot: "Wide",
		move: "Static",
		src: FRAME_ONE,
	},
	{
		id: 2,
		name: "Fixture proof",
		dur: 5,
		vo: "A second fixture beat answers it.",
		vis: "Simple fixture diagram",
		shot: "Medium",
		move: "Push in",
		src: FRAME_TWO,
	},
	{
		id: 3,
		name: "Fixture close",
		dur: 3,
		vo: "A third fixture beat closes the loop.",
		vis: "Fixture end card",
		shot: "Close",
		move: "Static",
		src: FRAME_THREE,
	},
];

/** Scene clips, their markers, and the one text clip, in schemaVersion 2.
 *
 *  Written as clips rather than as the legacy per-type arrays because that is
 *  what the document is: `toTimelineDoc` projects one way and `fromTimelineDoc`
 *  the other, and authoring the projection's output keeps the fixture in the
 *  shape a persisted project actually has. */
function sceneClips(): Array<Record<string, unknown>> {
	let start = 0;
	return SCENES.map((s) => {
		const clip = {
			id: `scene:${s.id}`,
			type: "image",
			startSec: start,
			durationSec: s.dur,
			track: 0,
			markerId: s.id,
			scene: {
				id: s.id,
				dur: s.dur,
				start,
				track: 0,
				name: s.name,
				shot: s.shot,
				move: s.move,
				vis: s.vis,
				vo: s.vo,
				img: true,
				src: s.src,
				transition: "cut",
			},
		};
		start += s.dur;
		return clip;
	});
}

function sceneMarkers(): Array<Record<string, unknown>> {
	let start = 0;
	return SCENES.map((s) => {
		const marker = {
			id: s.id,
			title: s.name,
			clipIds: [`scene:${s.id}`],
			startSec: start,
			endSec: start + s.dur,
			voiceoverText: s.vo,
		};
		start += s.dur;
		return marker;
	});
}

/** One text clip, on its own track above the scenes. It is what makes the clip
 *  inspector's text, transform and blending groups reachable. */
const TEXT_CLIP = {
	id: "text:1",
	type: "text",
	startSec: 4,
	durationSec: 4,
	track: 1,
	text: {
		id: 1,
		content: "Fixture measure 42%",
		start: 4,
		dur: 4,
		track: 1,
		preset: "plain",
		layout: { xPct: 6, yPct: 12, widthPct: 88, fit: "contain" },
	},
};

export const editorChatStoryboardJson = {
	schemaVersion: 2,
	sceneTextClipMigrationVersion: 1,
	clips: [...sceneClips(), TEXT_CLIP],
	markers: sceneMarkers(),
	captions: [],
	pacingDevices: [],
	unit_lifecycle: {},
	artifacts: [],
};

/* ── The chat log ──
 *
 * Two runs, and the split matters. `RunThinking` collapses a settled run, and
 * `settleChat` clears `running` on every persisted note, so a thinking card is
 * only ever reachable by opening the trail — which is why `editor-chat` clicks
 * "view thinking" to reach `.fc-note-body`. The second run carries a story plan
 * so the card that renders one is in the same capture as the card that does not.
 */
export const editorChatLog: Array<Record<string, unknown>> = [
	{ id: 1, role: "user", text: "Draft a three-beat fixture story." },
	{
		id: 2,
		role: "assistant",
		note: {
			title: "Planning",
			body: "Read the brief, drafted three beats, and measured them against the target runtime.",
			elapsedSec: 12,
			startedAt: at(1),
		},
	},
	{
		id: 3,
		role: "assistant",
		workflow: {
			id: "fixture-workflow",
			title: "Plan the fixture story",
			route: "plan_story",
			readonly: true,
			reason: "The brief asked for a full draft, so the planner ran end to end.",
			items: [
				{ id: "frame", label: "Frame the brief", status: "done", tool: "frame_brief" },
				{ id: "draft", label: "Draft the sections", status: "done", tool: "draft_sections" },
				{ id: "measure", label: "Measure against target", status: "done", tool: "measure_runtime" },
				{
					id: "voice",
					label: "Generate narration",
					status: "skipped",
					tool: "generate_speech",
					reason: "Not requested in this run.",
				},
			],
		},
	},
	{
		id: 4,
		role: "assistant",
		artifact: fixtureArtifact("story_plan", {
			targetSec: 12,
			planKind: "story",
			/* A real member of `STORY_ARCS`, and it has to be: `StoryPlanCard` runs
			 * arc coverage on every render, and an arc the spec does not know
			 * crashes it — which unmounts the editor around it, exactly as that
			 * card's own header warns. The fixture is not the place to carry that
			 * defect; see tasks.md 4.3. */
			arc: "three_act",
			visualStyle: "Flat two-tone fixture illustration",
			verificationStatus: "partial",
			citationCoverage: { verified: 1, total: 2 },
			sections: SCENES.map((s, i) => ({
				id: `fixture-section-${i + 1}`,
				title: s.name,
				narration: s.vo,
				visualPrompt: s.vis,
				estimatedDurationSec: s.dur,
				audioDurationSec: i === 0 ? s.dur : undefined,
				status: i === 0 ? "ready" : i === 1 ? "pending" : "draft",
				// Keys from the `three_act` arc above. A three-section plan on a
				// five-function arc compresses by design, so the card renders its
				// advisory structure warnings — which is a state worth photographing.
				chapterFunction: i === 0 ? "setup" : i === 1 ? "rising_action" : "climax",
				chapterObligation: "Fixture obligation for this beat.",
				sourceNotes: i === 1 ? "Fixture source note, unverified." : undefined,
			})),
		}),
	},
	{ id: 5, role: "user", text: "Add a text overlay to the second beat." },
	{
		id: 6,
		role: "assistant",
		note: {
			title: "Placing the overlay",
			body: "Mined the second beat for a numeric claim and placed one text overlay over it.",
			elapsedSec: 4,
			startedAt: at(6),
		},
	},
	{ id: 7, role: "assistant", text: "Added a text overlay over the second beat." },
];

/* ── The audit trace ──
 *
 * `GET /api/operations/projects/:id/trace` is absent from `api.har`, so the
 * audit panel has never rendered anything but its error state under replay. The
 * shape below is `audit-panel.tsx`'s own declared types: two sessions so the
 * Changes list is a list, assets on the tool calls so the Assets ledger is
 * populated, and one failed call so the failure tone is in the baseline too.
 */
export const editorChatTrace = {
	sessions: [
		{
			jobId: "fixture-run-01",
			contentType: "video",
			instruction: "Draft a three-beat fixture story.",
			status: "completed",
			startedAt: at(1),
			endedAt: at(3),
			approvals: [{ target: "story plan", at: at(3) }],
			outcomeContract: {
				objective: "A three-beat fixture story inside the target runtime.",
				targetDurationSec: 12,
			},
			outcomeEvaluation: {
				status: "passed",
				score: 88,
				findings: [
					{
						id: "fixture-finding-runtime",
						severity: "pass",
						message: "Runtime is inside the target.",
					},
					{
						id: "fixture-finding-visual",
						severity: "warning",
						message: "Beat three reuses the palette of beat one.",
						fix: { command: "Regenerate the visual for scene 3." },
					},
				],
			},
			toolCalls: [
				{
					id: "fixture-call-01",
					tool: "draft_sections",
					ok: true,
					durationMs: 2400,
					at: at(1),
					args: { beats: 3, targetSec: 12 },
					result: "Drafted 3 sections.",
					assets: [],
				},
				{
					id: "fixture-call-02",
					tool: "generate_frame",
					ok: true,
					durationMs: 8100,
					at: at(2),
					args: { scene: 1, prompt: "Two-tone fixture title card" },
					result: "Generated 1 frame.",
					assets: [
						{
							assetType: "image",
							url: FRAME_ONE,
							ref: "scene:1",
							prompt: "Two-tone fixture title card",
							model: "fixture-image",
						},
					],
				},
				{
					id: "fixture-call-03",
					tool: "generate_frame",
					ok: true,
					durationMs: 7600,
					at: at(2),
					args: { scene: 2, prompt: "Simple fixture diagram" },
					result: "Generated 1 frame.",
					assets: [
						{
							assetType: "image",
							url: FRAME_TWO,
							ref: "scene:2",
							prompt: "Simple fixture diagram",
							model: "fixture-image",
						},
					],
				},
			],
		},
		{
			jobId: "fixture-run-02",
			contentType: "video",
			instruction: "Add a stat callout to the second beat.",
			status: "completed",
			startedAt: at(6),
			endedAt: at(7),
			approvals: [],
			outcomeContract: { objective: "One stat callout over the second beat." },
			outcomeEvaluation: {
				status: "needs_attention",
				score: 61,
				findings: [
					{
						id: "fixture-finding-speech",
						severity: "blocker",
						message: "Beat three has no narration audio.",
						fix: { command: "Generate narration for scene 3." },
					},
				],
			},
			toolCalls: [
				{
					id: "fixture-call-04",
					tool: "add_text",
					ok: true,
					durationMs: 320,
					at: at(6),
					args: { content: "Fixture measure 42%", scene: 2 },
					result: "Placed 1 overlay.",
					assets: [],
				},
				{
					id: "fixture-call-05",
					tool: "generate_speech",
					ok: false,
					durationMs: 1900,
					at: at(7),
					args: { scene: 3 },
					result: "No voice configured for this workspace.",
					assets: [],
				},
			],
		},
	],
	artifacts: [
		{
			id: "fixture-artifact-01",
			logical_ref: "scene:1",
			parent_artifact_id: null,
			public_url: FRAME_ONE,
			version: 2,
			active: 1,
			created_at: at(2),
		},
		{
			id: "fixture-artifact-02",
			logical_ref: "scene:2",
			parent_artifact_id: null,
			public_url: FRAME_TWO,
			version: 1,
			active: 1,
			created_at: at(2),
		},
		{
			id: "fixture-artifact-03",
			logical_ref: "scene:3",
			parent_artifact_id: null,
			public_url: FRAME_THREE,
			version: 1,
			active: 1,
			created_at: at(3),
		},
	],
	quality: {
		runCount: 2,
		outcomePassPct: 50,
		briefCoveragePct: 100,
		visualContinuityPct: 67,
		beatsPerPlannedShot: 1,
		visualBeatReusePct: 0,
		firstUsableOutputMs: 8100,
		targetedFixSuccessPct: null,
		renderPassPct: null,
		durationErrorPct: 4,
		unsupportedClaimCount: 1,
		totalToolCost: 0.42,
		totalGenerationTimeMs: 20_320,
		feedback: { accept: 1, regenerate: 1, rollback: 0 },
	},
};

/** The project record the detail response carries. */
export const editorChatProject = {
	id: EDITOR_CHAT_PROJECT_ID,
	workspace: "fixture-workspace",
	title: "Fixture Chat Project",
	type: "video",
	status: "storyboard",
	target_platform: null,
	target_audience: null,
	target_duration_sec: 12,
	target_format: "16:9",
	language: null,
	campaign_id: null,
	brief_json: null,
	reference_notes: null,
	created_at: T0,
	updated_at: at(7),
	editor_state_json: { chat: editorChatLog },
	storyboard_count: 1,
	reference_count: 0,
	render_count: 0,
	output_count: 0,
	latest_storyboard_id: "fixture-chat-storyboard",
	latest_storyboard_version: 1,
	latest_output_status: null,
	latest_output_updated_at: null,
};

/** The whole `/api/operations/projects/:id` body. */
export const editorChatProjectDetail = {
	project: editorChatProject,
	storyboards: [
		{
			id: "fixture-chat-storyboard",
			project_id: EDITOR_CHAT_PROJECT_ID,
			version: 1,
			status: "approved",
			source_prompt: "A three-beat fixture story.",
			reference_notes: null,
			storyboard_json: editorChatStoryboardJson,
			created_at: at(3),
		},
	],
	entities: [],
	notes: [],
	speakers: [],
	renders: [],
	outputs: [],
	events: [
		{
			id: 1,
			project_id: EDITOR_CHAT_PROJECT_ID,
			kind: "created",
			summary: "Fixture event 1.",
			payload_json: { title: "Fixture Chat Project" },
			created_at: T0,
		},
		{
			id: 2,
			project_id: EDITOR_CHAT_PROJECT_ID,
			kind: "edited",
			summary: "Fixture event 2.",
			payload_json: { instruction: "fixture edit" },
			created_at: at(6),
		},
	],
};
