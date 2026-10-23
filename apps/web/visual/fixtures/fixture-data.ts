/* The visual suite's data, authored rather than recorded.
 *
 * The previous fixture was a recording of one developer's database. That is why
 * it carried real names, real project titles and 18,150 content rows, and why
 * `37a1c75b` had to empty it before an open-source release — after which every
 * library surface rendered its empty state and the suite went on passing 290
 * tests while asking nothing.
 *
 * Everything here is chosen. The names are deliberately unmistakable so that a
 * reviewer looking at a committed screenshot can tell it is fixture data from
 * the image, without tracing a name back to a source. That is the check the
 * scrub failed: it emptied the JSON and left the pictures of the JSON.
 *
 * Sufficiency is per surface, not a row count — see
 * `openspec/changes/rebuild-the-visual-fixture`. Each block below says which
 * surface it feeds and what that surface needs to render its populated state.
 *
 * A reference image's `src` is an inline `data:` SVG, not an `/uploads/…` path.
 * The suite replays `**\/api\/**` and nothing else, so an uploads path reaches a
 * dev-server proxy pointing at an API that is not running and the card degrades
 * to its seed gradient — which renders no `<img>` at all, and two of the
 * `library-chrome` tests assert `object-fit` on one. `apiUrl` passes `data:`
 * through untouched, by an explicit branch, so an inline SVG gives a real image
 * element with no network, no asset to ship, a deterministic capture, and
 * nobody's photograph in a committed baseline.
 */

/** A flat two-tone SVG, distinct per hue, as a `data:` URI.
 *
 *  Deliberately not a photograph and not a gradient: a reviewer looking at a
 *  baseline should be able to tell at a glance that the image is generated. */
function fixtureImage(hue: number, letter: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">` +
		`<rect width="120" height="160" fill="hsl(${hue} 45% 62%)"/>` +
		`<rect x="12" y="12" width="96" height="136" fill="none" stroke="hsl(${hue} 45% 88%)" stroke-width="3"/>` +
		`<text x="60" y="92" font-family="monospace" font-size="46" fill="hsl(${hue} 45% 92%)" text-anchor="middle">${letter}</text>` +
		`</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The workspace every fixture record belongs to. Not "default": a capture
 *  showing a real-sounding workspace name is the ambiguity this fixture exists
 *  to remove. The project UUID stays as it was — it is already synthetic, and
 *  changing it would move `screens.ts`, the HAR keys and the editor specs for
 *  no gain. */
export const FIXTURE_WORKSPACE = "fixture-workspace";

/** Direct Storyboard view: two semantic beats, one approved revision, no remote media. */
export const storyboardAuthoringState = {
	planId: "fixture-story-plan",
	draft: {
		revisionId: "fixture-story-revision",
		sections: [
			{
				id: "fixture-section-opening",
				title: "Fixture opening",
				beats: [
					{
						id: "fixture-beat-hook",
						title: "Synthetic hook",
						narration: "A fixture hook establishes the question.",
						visualPrompt: "Two-tone fixture title card",
						emotion: "curious",
						pacing: "brisk",
						editorial: {
							purpose: "establish",
							presentation: "headline",
							visualConcept: "A sealed door opens onto a bright unknown room",
							noveltyKey: "threshold reveal",
							onScreenText: "What changes first?",
							sfxCue: null,
							shots: [
								{
									index: 0,
									visualIntent:
										"Mara reaches for the sealed archive door as hard light leaks through its frame.",
									role: "continuity",
									bindings: [
										{ entityId: "fixture-ref-character" },
										{ plannedKey: "fixture-archive-door" },
									],
									rationale: "Introduces Mara and the recurring threshold together.",
								},
							],
						},
					},
					{
						id: "fixture-beat-proof",
						title: "Synthetic proof",
						narration: "A second fixture beat answers it.",
						visualPrompt: "Simple fixture diagram",
						emotion: "confident",
						pacing: "measured",
						editorial: {
							purpose: "explain",
							presentation: "explainer",
							visualConcept: "Cutaway diagram showing two measured stages",
							noveltyKey: "measured cutaway",
							sfxCue: "single wooden latch snap",
							shots: [
								{
									index: 0,
									visualIntent:
										"A clean cutaway isolates the archive lock before and after release.",
									role: "novelty",
									bindings: [{ plannedKey: "fixture-archive-door" }],
									rationale: "Keeps measured change tied to one approved prop.",
								},
							],
						},
					},
				],
			},
		],
	},
	approvedSnapshot: {
		revisionId: "fixture-story-revision",
		sections: [
			{
				id: "fixture-section-opening",
				title: "Fixture opening",
				beats: [
					{
						id: "fixture-beat-hook",
						title: "Synthetic hook",
						narration: "A fixture hook establishes the question.",
						visualPrompt: "Two-tone fixture title card",
						editorial: {
							purpose: "establish",
							presentation: "headline",
							visualConcept: "A sealed door opens onto a bright unknown room",
							noveltyKey: "threshold reveal",
							onScreenText: "What changes first?",
							sfxCue: null,
						},
					},
					{
						id: "fixture-beat-proof",
						title: "Synthetic proof",
						narration: "A second fixture beat answers it.",
						visualPrompt: "Simple fixture diagram",
						editorial: {
							purpose: "explain",
							presentation: "explainer",
							visualConcept: "Cutaway diagram showing two measured stages",
							noveltyKey: "measured cutaway",
							sfxCue: "single wooden latch snap",
						},
					},
				],
			},
		],
		approvalMode: "explicit",
		extensionPolicy: "review_additions",
		approvedAt: "2026-01-01T00:00:00.000Z",
	},
};

/* ── /api/workspaces → workspace switcher ──
 * More than one row makes switching visible. Names remain unmistakable in every
 * sidebar capture. */
export const workspaces = [
	{
		name: FIXTURE_WORKSPACE,
		display_name: "Fixture Workspace",
		status: "active",
		color: "#6d5dfc",
		color_bright: "#8d82ff",
		color_deep: "#4939ca",
		tagline: "Synthetic visual-test data",
		initials: "FW",
		project_count: 24,
	},
	{
		name: "fixture-workspace-two",
		display_name: "Fixture Workspace Two",
		status: "active",
		color: "#0aa6a6",
		color_bright: "#42c7c7",
		color_deep: "#087777",
		tagline: "Synthetic visual-test data",
		initials: "F2",
		project_count: 0,
	},
];

/* ── /api/operations/catalogue → library-references ──
 *
 * `library-chrome.spec.ts` filters by every reference kind the chips offer and
 * opens the first card's detail sheet, so the fixture carries one image per
 * kind. The pre-scrub recording had only `character` and `style`, so the
 * `Location`, `Product` and `Prop` filters were never exercised by a screenshot
 * or by a test — they could have been broken for as long as they have existed.
 */
const REFERENCE_KINDS = ["style", "character", "location", "product", "prop"] as const;

export const catalogueImages = REFERENCE_KINDS.map((kind, i) => ({
	id: `fixture-ref-${kind}`,
	label: `Fixture ${kind[0].toUpperCase()}${kind.slice(1)}`,
	tags: [kind],
	kind,
	note: `Fixture reference for the ${kind} filter.`,
	// Spread across the hue wheel so five cards are visibly distinct in a
	// capture; `gradFor` takes this modulo 360.
	seed: 40 + i * 67,
	default: false,
	src: fixtureImage(40 + i * 67, kind[0].toUpperCase()),
	workspace: FIXTURE_WORKSPACE,
	collection: "references",
	item_id: `fixture-ref-${kind}`,
}));

export const catalogueProducts = [1, 2, 3].map((n) => ({
	id: `fixture-product-${n}`,
	label: `Fixture Product ${n}`,
	tags: ["product"],
	kind: "product",
	note: "",
	seed: 120 + n * 40,
	default: false,
	src: fixtureImage(120 + n * 40, "P"),
	workspace: FIXTURE_WORKSPACE,
	collection: "products",
	item_id: `fixture-product-${n}`,
}));

/* ── voices → library-voices ──
 *
 * Two shapes, not one, because two endpoints answer with different records and
 * the surfaces read different fields. `/api/tts/status` answers
 * `{id,name,desc}`; the catalogue answers those plus `lang`, `gender` and
 * `sampleUrl`, and `voices-library.tsx` groups its rows by provider and
 * language. Giving both endpoints the leaner record renders the page with no
 * groups at all — which is what a single shared list produced on the first
 * attempt here.
 *
 * Two languages, one provider — see `voiceProviders` below for why the second
 * provider had to go. */
const VOICE_SPECS = [
	["one", "Fixture Voice One", "Female · calm", "EN-US", "female", "fixture-speech"],
	["two", "Fixture Voice Two", "Male · warm", "EN-US", "male", "fixture-speech"],
	["three", "Fixture Voice Three", "Female · bright", "EN-US", "female", "fixture-speech"],
	["four", "Fixture Voice Four", "Male · low", "EN-GB", "male", "fixture-speech"],
	["five", "Fixture Voice Five", "Neutral · even", "EN-GB", "neutral", "fixture-speech"],
	["six", "Fixture Voice Six", "Female · quick", "EN-GB", "female", "fixture-speech"],
] as const;

/** The catalogue's richer record: what `library-voices` groups and renders. */
export const catalogueVoices = VOICE_SPECS.map(([slug, name, desc, lang, gender, provider]) => ({
	id: `fixture-voice-${slug}`,
	name,
	desc,
	lang,
	gender,
	provider,
	// No sample to play: the suite serves no audio, and a preview button with a
	// dead URL is a worse capture than one with none.
	sampleUrl: null,
}));

/** The catalogue's `voiceProviders`: `TtsProviderOption[]`, each holding its own
 *  voices, sent as `voice_providers` — the wire is snake_case and
 *  `fetchContentCatalogue` maps it to `voiceProviders`. Neither
 *  the scrubbed fixture nor the recording before it carried that key at all —
 *  the catalogue answered `images`, `voices`, `products` and nothing else. So
 *  `library-voices` rendered empty before the scrub as well, for a different
 *  reason than every other surface here, and no baseline said so. */
export const voiceProviders = [
	/* ONE provider, deliberately. `library-chrome.spec.ts` asserts the voices
	 * toolbar carries no group chips, and its comment says why: "a chip row per
	 * language would be inventing a taxonomy to fill the toolbar." A second
	 * provider in the fixture puts chips there and fails that test — the fixture
	 * inventing exactly the taxonomy the surface declines to. The provider-and-
	 * language section headings are still exercised, because the six voices span
	 * two languages. */
	{ id: "fixture-speech", label: "Fixture Speech", health: "ready" as const },
].map((p) => ({
	...p,
	voices: catalogueVoices
		.filter((v) => v.provider === p.id)
		.map(({ id, name, desc, lang, gender }) => ({
			id,
			name,
			desc,
			lang,
			gender,
			hue: lang === "EN-US" ? 200 : 320,
		})),
}));

/** `/api/tts/status`'s leaner record. */
export const ttsVoices = VOICE_SPECS.map(([slug, name, desc]) => ({
	id: `fixture-voice-${slug}`,
	name,
	desc,
}));

/* ── /api/operations/content/feed → content-list ──
 *
 * The capture includes the pagination footer, so the list has to page: the
 * request is `limit=20`, and 24 rows put "Page 1 / 2" under it rather than the
 * "1–3 of 3" the scrubbed fixture produces. Types cycle so all three filter
 * chips have matching rows.
 *
 * Timestamps are fixed rather than relative. A fixture whose dates are computed
 * from "now" renders a different string every day and teaches people to refresh
 * baselines without reading them, which is the habit that let a stale build go
 * unnoticed for a release.
 */
const FIXED_CREATED = Date.UTC(2026, 0, 1, 3, 14);
const TYPES = ["video", "image", "text"] as const;

export const contentFeedItems = Array.from({ length: 24 }, (_, i) => ({
	id: `fixture-content-${String(i + 1).padStart(2, "0")}`,
	workspace: FIXTURE_WORKSPACE,
	title: `Fixture Content ${String(i + 1).padStart(2, "0")}`,
	type: TYPES[i % TYPES.length],
	status: "storyboard",
	target_platform: null,
	target_audience: null,
	target_duration_sec: null,
	target_format: null,
	language: null,
	campaign_id: null,
	brief_json: null,
	reference_notes: null,
	created_at: FIXED_CREATED,
	updated_at: FIXED_CREATED,
	editor_state_json: null,
}));

/* ── /api/video/jobs → video ──
 * Three attributed terminal attempts keep the collection populated without
 * polling or external services. */
export const videoJobs = [
	{
		id: "fixture-video-job-done",
		project_id: "fixture-project-done",
		project_title: "Fixture portrait project",
		duration_sec: 12,
		preset: "Fixture Portrait",
		status: "done",
		phase: "finalizing",
		phase_detail: null,
		output_path: "/fixture/video-done.mp4",
		error: null,
		error_code: null,
		progress: 1,
		created_at: FIXED_CREATED,
		finished_at: FIXED_CREATED + 60_000,
	},
	{
		id: "fixture-video-job-fallback",
		project_id: "fixture-project-fallback",
		project_title: "Fixture square project",
		duration_sec: 12,
		preset: "Fixture Square",
		status: "done_with_fallback",
		phase: "finalizing",
		phase_detail: "fixture silent audio",
		output_path: "/fixture/video-fallback.mp4",
		error: null,
		error_code: null,
		progress: 1,
		created_at: FIXED_CREATED - 60_000,
		finished_at: FIXED_CREATED,
	},
	{
		id: "fixture-video-job-error",
		project_id: "fixture-project-error",
		project_title: "Fixture landscape project",
		duration_sec: 12,
		preset: "Fixture Landscape",
		status: "error",
		phase: "rendering",
		phase_detail: null,
		output_path: null,
		error: "Fixture render failure",
		error_code: "RENDER_FAILED",
		progress: 0.6,
		created_at: FIXED_CREATED - 120_000,
		finished_at: FIXED_CREATED - 60_000,
	},
];

/* ── /api/credits/usage and /api/credits/transactions → settings-usage ──
 * Both answered zero rows after the scrub, so both settings captures showed an
 * empty table where the surface exists to show a populated one. */
export const creditUsageItems = Array.from({ length: 8 }, (_, i) => ({
	id: `fixture-usage-${i + 1}`,
	account_id: "fixture-account",
	reservation_id: null,
	operation: ["llm", "image", "tts"][i % 3],
	provider: ["fixture-text", "fixture-image", "fixture-speech"][i % 3],
	model: "fixture-model",
	quantity: 100 + i * 25,
	unit: "estimated_token",
	provider_cost_usd: 0,
	charged_credits: i + 1,
	pricing_version: "2026-01-01",
	metadata_json: JSON.stringify({ inputTokens: 100, outputTokens: 50, durationMs: 1000 }),
	created_at: FIXED_CREATED,
}));

export const creditTransactionItems = Array.from({ length: 8 }, (_, i) => ({
	id: `fixture-txn-${i + 1}`,
	account_id: "fixture-account",
	kind: i % 2 === 0 ? "debit" : "grant",
	credits: i % 2 === 0 ? -(i + 1) : 100,
	reason: i % 2 === 0 ? "generation" : "daily_grant",
	created_at: FIXED_CREATED,
}));
