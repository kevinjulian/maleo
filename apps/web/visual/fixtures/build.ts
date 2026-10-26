#!/usr/bin/env bun
/* Overlay the authored data in `fixture-data.ts` onto the HAR the suite replays.
 *
 *   bun visual/fixtures/build.ts            # write api.har
 *   bun visual/fixtures/build.ts --check    # fail if api.har is out of date
 *
 * An overlay rather than a generator, deliberately. The HAR's request and
 * response envelopes — headers, status, the `Access-Control-*` set, the exact
 * URLs `routeFromHAR` matches on — are correct and are not what went wrong.
 * What went wrong was the data inside them, so this replaces only that, and the
 * diff of a rebuild is the data.
 *
 * `--check` exists so a fixture edited by hand, or an authored source changed
 * without a rebuild, fails rather than drifting. That is the same failure the
 * suite already had once at a different layer: an artifact nobody rebuilt,
 * silently deciding what the baselines mean.
 */
import { cleanRetiredVisualTemplate, PLAIN_TEXT_AUTHOR_STYLE } from "@maleo/shared";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	catalogueImages,
	catalogueProducts,
	contentFeedItems,
	creditTransactionItems,
	catalogueVoices,
	creditUsageItems,
	ttsVoices,
	videoJobs,
	voiceProviders,
	workspaces,
} from "./fixture-data.ts";
import {
	EDITOR_CHAT_PROJECT_ID,
	editorChatProjectDetail,
	editorChatTrace,
} from "./editor-chat-data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HAR = resolve(HERE, "api.har");
const EDITOR_CHAT_HAR = resolve(HERE, "api-editor-chat.har");

/** endpoint match -> how to rewrite that response body. */
const OVERLAYS: ReadonlyArray<{ match: RegExp; apply: (body: Record<string, unknown>) => void }> = [
	{
		match: /\/api\/operations\/catalogue/,
		apply: (b) => {
			b.images = catalogueImages;
			b.products = catalogueProducts;
			b.voices = catalogueVoices;
			b.voice_providers = voiceProviders;
		},
	},
	{
		match: /\/api\/operations\/content\/feed/,
		apply: (b) => {
			/* `total` as well as `items`, because they are read by different parts of
			 * the same screen and disagreeing is invisible in the data. Setting only
			 * `items` rendered 24 rows under a header chip reading "CONTENT 3" and a
			 * footer reading "1-3 of 3, Page 1 / 1" — a capture that looks right
			 * until you read the numbers on it. The recorded response pages
			 * server-side, so `total` is the count the fixture claims exists, not the
			 * length of this page. */
			b.items = contentFeedItems.slice(0, 20);
			b.total = contentFeedItems.length;
		},
	},
	{
		match: /\/api\/tts\/status/,
		apply: (b) => {
			b.voices = ttsVoices;
		},
	},
	{
		match: /\/api\/credits\/usage/,
		apply: (b) => {
			b.items = creditUsageItems;
		},
	},
	{
		match: /\/api\/credits\/transactions/,
		apply: (b) => {
			b.items = creditTransactionItems;
		},
	},
	{
		match: /\/api\/workspaces$/,
		apply: (b) => {
			b.items = workspaces;
			delete b.error;
		},
	},
	{
		match: /\/api\/video\/jobs$/,
		apply: (b) => {
			b.items = videoJobs;
			delete b.error;
		},
	},
	{
		match: /\/api\/video\/(?:presets|templates)$/,
		apply: (b) => {
			b.items = [];
			delete b.error;
		},
	},
	{ match: /\/api\/credits\/balance$/, apply: sanitizeCreditBalance },
	{ match: /\/api\/settings\/global$/, apply: sanitizeGlobalSettings },
	{
		match: /\/api\/settings\/research-status$/,
		apply: (b) => {
			b.status = { configured: false, url: "", connected: false, toolCount: 0, allowedTools: [] };
		},
	},
	{
		match: /\/api\/settings\/captions-status$/,
		apply: (b) => {
			b.status = {
				ready: false,
				enabled: false,
				model: "base",
				version: "fixture",
				whisperDir: "/fixture/whisper",
				cacheDir: "/fixture/captions",
				mainInstalled: false,
				modelInstalled: false,
			};
		},
	},
	{ match: /\/api\/operations\/projects\/[^/]+$/, apply: sanitizeProject },
	{ match: /\/api\/operations\/content-presets$/, apply: sanitizePresets },
	{ match: /\/api\/operations\/content-materials$/, apply: sanitizeMaterials },
	{
		match: /\/api\/operations\/clip-templates$/,
		apply: (b) => {
			b.items = renameRecords(b.items, "Fixture Element")
				.map((item) => cleanRetiredVisualTemplate(item).value)
				.filter((item) => item !== null);
		},
	},
	{
		match: /\/api\/operations\/motion-presets$/,
		apply: (b) => {
			b.items = renameRecords(b.items, "Fixture Motion");
		},
	},

	/* Timeline templates are widened rather than written out. Their records are
	 * mechanical configuration — 28 fields of pacing and transition settings —
	 * and none of that is anyone's data; what identifies them is the name, and
	 * the one left over was a scratch artifact called "Test Template". So the
	 * shape is kept, the naming is replaced, and the record is repeated enough
	 * times that the surface renders as a grid rather than a single tile.
	 * Hand-authoring 28 mechanical fields to reach the same structure would be
	 * transcription, not a decision. The first record keeps its id, because
	 * presets reference a template by it.
	 *
	 * THREE collections are deliberately NOT here, each for its own reason:
	 *
	 * - Content presets. `stock-attribution.spec.ts` asserts "Example Project
	 *   Preset" is visible, which is already synthetic, so renaming breaks a test
	 *   and buys nothing. Widening is blocked separately: each preset triggers a
	 *   `/content-presets/:id/usage` request the fixture answers for none of them
	 *   — not even the one it already held — so extra records multiply an
	 *   existing gap under `notFound: "abort"`.
	 *
	 * - Clip templates and motion presets. Widening these broke three
	 *   `studio-parity` tests: Motion Studio stopped following the playhead
	 *   entirely, failing with "never started following". Their records are
	 *   referenced by id from elsewhere in the fixture, so copying and renumbering
	 *   them severs a link the studio needs. Verified by removing the widening
	 *   alone — the test passes again with nothing else changed.
	 *
	 * The general lesson, which is why this is written down: a record that
	 * something else points at cannot be multiplied by copying. Widen leaf
	 * collections, not referenced ones. */
	{
		match: /\/api\/operations\/timeline-templates/,
		apply: (b) => {
			b.items = widen(b.items, "Fixture Template", 4).map((item) => ({
				...(item as Record<string, unknown>),
				introMotionPreset: "plain",
				sectionMotionPreset: "plain",
			}));
		},
	},
];

/** Repeat a collection's records up to `count`, renaming every one.
 *
 *  Cycles through whatever shapes the collection already holds, so a collection
 *  with two differently-configured records keeps both rather than flattening to
 *  one repeated `count` times. */
function widen(items: unknown, label: string, count: number): unknown[] {
	const source = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
	if (source.length === 0) return [];
	return Array.from({ length: count }, (_, i) => {
		const base = { ...source[i % source.length] };
		const n = String(i + 1).padStart(2, "0");
		if (i > 0) base.id = `fixture-${label.toLowerCase().replace(/\s+/g, "-")}-${n}`;
		if ("name" in base) base.name = `${label} ${n}`;
		if ("label" in base) base.label = `${label} ${n}`;
		if ("description" in base) base.description = `Fixture record ${n}.`;
		if ("intent" in base) base.intent = `Fixture intent ${n}.`;
		if ("introEntrySfx" in base) base.introEntrySfx = "Fixture intro sound";
		if ("introEntrySfxUrl" in base) base.introEntrySfxUrl = "";
		if ("sceneEntrySfx" in base) base.sceneEntrySfx = "Fixture scene sound";
		if ("sceneEntrySfxUrl" in base) base.sceneEntrySfxUrl = "";
		if ("imageGuidancePrompt" in base) base.imageGuidancePrompt = "Fixture image guidance.";
		return base;
	});
}

function records(items: unknown): Record<string, unknown>[] {
	return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/** Rename without changing ids: editor fixtures point at these records. */
function renameRecords(items: unknown, label: string): Record<string, unknown>[] {
	return records(items).map((item, i) => ({
		...item,
		...("name" in item ? { name: `${label} ${i + 1}` } : {}),
		...("label" in item ? { label: `${label} ${i + 1}` } : {}),
		...("intent" in item ? { intent: `Fixture intent ${i + 1}.` } : {}),
	}));
}

function sanitizePresets(body: Record<string, unknown>): void {
	body.items = records(body.items).map((item, i) => ({
		...item,
		// Existing visual behavior test names this deliberately synthetic preset.
		name: i === 0 ? "Example Project Preset" : `Fixture Project Preset ${i + 1}`,
		description: `Synthetic preset ${i + 1} for visual tests.`,
	}));
}

function sanitizeMaterials(body: Record<string, unknown>): void {
	body.items = records(body.items)
		.filter((item) => item.source === "fixture")
		.map((item, i) => {
			const group = typeof item.group === "string" ? item.group : "material";
			const n = String(i + 1).padStart(2, "0");
			// Library behavior test searches "Cinematic" inside active Visual group.
			// Derive from stable group, never current HAR text, so rebuild can undo edits.
			const searchMarker = group === "visual" ? " Cinematic" : "";
			return {
				...item,
				id: `fixture-material-${n}`,
				workspace: "",
				name: `Fixture${searchMarker} ${group[0]?.toUpperCase()}${group.slice(1)} Material ${n}`,
				description: `Synthetic ${group} material ${n}.`,
				body: `Fixture ${group} guidance ${n}.`,
				assetIds: [],
				slug: `fixture-${group}-material-${n}`,
			};
		});
}

function sanitizeProject(body: Record<string, unknown>): void {
	const project = body.project as Record<string, unknown> | undefined;
	if (project)
		Object.assign(project, { workspace: "fixture-workspace", title: "Fixture Timeline Project" });
	for (const storyboard of records(body.storyboards)) {
		const doc = storyboard.storyboard_json as
			| { clips?: Array<Record<string, unknown>> }
			| undefined;
		for (const clip of doc?.clips ?? []) {
			const text = clip.text as Record<string, unknown> | undefined;
			if (text && typeof text.content === "string") {
				text.content = "FIXTURE";
				// This synthetic editable text sample now authors the retained primitive.
				if (text.preset === "title") {
					text.preset = "plain";
				}
				if (text.preset === "plain") {
					text.style ??= { ...PLAIN_TEXT_AUTHOR_STYLE };
					text.layout ??= { xPct: 8, yPct: 18, widthPct: 84, heightPct: 34, fit: "contain" };
				}
			}
		}
	}
	for (const [i, event] of records(body.events).entries()) {
		event.summary = `Fixture event ${i + 1}.`;
		const payload = event.payload_json as Record<string, unknown> | undefined;
		if (payload?.title) payload.title = "Fixture Timeline Project";
		if (payload?.instruction) payload.instruction = "fixture edit";
	}
}

function sanitizeGlobalSettings(body: Record<string, unknown>): void {
	body.items = records(body.items).map((item) => ({
		...item,
		set: false,
		value_masked: "",
		source: "unset",
	}));
}

function sanitizeCreditBalance(body: Record<string, unknown>): void {
	const account = body.account as Record<string, unknown> | undefined;
	if (account) Object.assign(account, { id: "fixture-account", scope_id: "fixture-workspace" });
}

interface HarEntry {
	request: { url: string };
	response: {
		status: number;
		statusText: string;
		headers: Array<{ name: string; value: string }>;
		content: { text?: string; size?: number };
	};
}

function rebuild(source: string): string {
	const har = JSON.parse(source) as { log: { entries: HarEntry[] } };
	for (const entry of har.log.entries) {
		const overlay = OVERLAYS.find((o) => o.match.test(entry.request.url));
		if (!overlay) continue;
		const text = entry.response.content.text;
		if (text === undefined) continue;
		/* SAFETY: every overlaid endpoint answers a JSON object in the recorded
		 * fixture — verified by the parse below, which throws and fails the build
		 * rather than silently skipping if that ever stops being true. */
		const body = JSON.parse(text) as Record<string, unknown>;
		overlay.apply(body);
		const next = JSON.stringify(body);
		const size = new TextEncoder().encode(next).length;
		entry.response.status = 200;
		entry.response.statusText = "OK";
		entry.response.content.text = next;
		// The recorded `size` is the byte length of the body; a stale one makes the
		// fixture describe a payload it does not contain.
		entry.response.content.size = size;
		const contentLength = entry.response.headers.find(
			(header) => header.name.toLowerCase() === "content-length",
		);
		if (contentLength) contentLength.value = String(size);
	}
	return `${JSON.stringify(har, null, 0)}\n`;
}

/* ── The second fixture ──
 *
 * `api-editor-chat.har` is DERIVED from `api.har` rather than recorded: same
 * envelopes, same headers, same status codes, with the project swapped for one
 * that has scenes, a chat log and an audit trace. See `editor-chat-data.ts` for
 * why authoring beats recording here, and `screens.ts` for which screens replay
 * which fixture.
 *
 * Deriving rather than hand-writing a HAR is what keeps the two in step: a route
 * added to the recording reaches both fixtures, and the response envelope cannot
 * drift between them because there is only one of it.
 */

/** The `/trace` entry `api.har` never carried, built on a cloned envelope so it
 *  matches `routeFromHAR` the same way every other entry does. */
function traceEntry(template: HarEntry, url: string): HarEntry {
	const entry = structuredClone(template);
	entry.request.url = url;
	return withBody(entry, editorChatTrace as unknown as Record<string, unknown>);
}

/** Replace an entry's body and reconcile everything that describes its size. */
function withBody(entry: HarEntry, body: Record<string, unknown>): HarEntry {
	const text = JSON.stringify(body);
	const size = new TextEncoder().encode(text).length;
	entry.response.status = 200;
	entry.response.statusText = "OK";
	entry.response.content.text = text;
	entry.response.content.size = size;
	const contentLength = entry.response.headers.find(
		(header) => header.name.toLowerCase() === "content-length",
	);
	if (contentLength) contentLength.value = String(size);
	return entry;
}

function deriveEditorChat(source: string): string {
	const har = JSON.parse(source) as { log: { entries: HarEntry[] } };
	const projectDetail = /\/api\/operations\/projects\/[^/?]+$/;
	const projectScoped = /\/api\/operations\/projects\/[0-9a-f-]{36}/;
	const entries: HarEntry[] = [];
	let detailTemplate: HarEntry | null = null;
	for (const entry of har.log.entries) {
		/* Every project-scoped URL is re-keyed, because `routeFromHAR` matches on
		 * the URL and a request for this project would otherwise miss every entry
		 * and hit `notFound: "abort"`. */
		entry.request.url = entry.request.url.replace(projectScoped, (match) =>
			match.replace(/[0-9a-f-]{36}$/, EDITOR_CHAT_PROJECT_ID),
		);
		if (projectDetail.test(entry.request.url)) {
			detailTemplate = entry;
			entries.push(withBody(entry, editorChatProjectDetail as unknown as Record<string, unknown>));
			continue;
		}
		entries.push(entry);
	}
	if (!detailTemplate)
		throw new Error("fixture: api.har has no project detail entry to derive from");
	entries.push(traceEntry(detailTemplate, `${detailTemplate.request.url}/trace`));
	har.log.entries = entries;
	return `${JSON.stringify(har, null, 0)}\n`;
}

const current = await Bun.file(HAR).text();
const next = rebuild(current);
const currentEditorChat = (await Bun.file(EDITOR_CHAT_HAR).exists())
	? await Bun.file(EDITOR_CHAT_HAR).text()
	: "";
const nextEditorChat = deriveEditorChat(next);

if (process.argv.includes("--check")) {
	const stale = [
		current === next ? null : "api.har",
		currentEditorChat === nextEditorChat ? null : "api-editor-chat.har",
	].filter(Boolean);
	if (stale.length === 0) {
		console.log("fixture: api.har and api-editor-chat.har match their authored sources");
		process.exit(0);
	}
	console.error(
		`fixture: ${stale.join(" and ")} out of date — run \`bun visual/fixtures/build.ts\``,
	);
	process.exit(1);
}

await Bun.write(HAR, next);
await Bun.write(EDITOR_CHAT_HAR, nextEditorChat);
const counts = [
	`references=${catalogueImages.length}`,
	`products=${catalogueProducts.length}`,
	`voices=${catalogueVoices.length}`,
	`content=${contentFeedItems.length}`,
	`usage=${creditUsageItems.length}`,
	`transactions=${creditTransactionItems.length}`,
];
console.log(`fixture: wrote api.har — ${counts.join(" ")}`);
console.log(
	`fixture: wrote api-editor-chat.har — project=${EDITOR_CHAT_PROJECT_ID} trace sessions=${editorChatTrace.sessions.length}`,
);
