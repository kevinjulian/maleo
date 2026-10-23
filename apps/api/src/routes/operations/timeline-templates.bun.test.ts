import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import {
	DEFAULT_TIMELINE_TEMPLATE,
	DEFAULT_TIMELINE_TEMPLATE_SLUG,
	TIMELINE_TEMPLATE_FIXTURES,
	type TimelineTemplate,
	type TimelineTemplateInput,
} from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import {
	createContentTimelineTemplate,
	listContentTimelineTemplates,
	updateContentTimelineTemplate,
} from "@maleo/db/timeline-templates";
import { registerTimelineTemplateRoutes } from "./timeline-templates.ts";
import { setStockAudioResolverForTests } from "@maleo/stock";

const dbPath = join(tmpdir(), "maleo-timeline-template-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	registerTimelineTemplateRoutes(instance);
	return instance;
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	setStockAudioResolverForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("global timeline templates", () => {
	test("seeds default and supports create, update, delete", async () => {
		const server = app();
		const initial = await server.request("/timeline-templates");
		const initialBody = (await initial.json()) as { items: TimelineTemplate[] };
		// Addressed by SLUG, not by a hardcoded id: a fresh database assigns fixture rows
		// their own ids, and only a database that already held the legacy row keeps it.
		expect(
			initialBody.items.map((item) => item.slug).sort((a, b) => (a ?? "").localeCompare(b ?? "")),
		).toEqual(
			TIMELINE_TEMPLATE_FIXTURES.map((fixture) => fixture.slug).sort((a, b) => a.localeCompare(b)),
		);
		for (const fixture of initialBody.items) {
			expect(
				(await server.request(`/timeline-templates/${fixture.id}`, { method: "DELETE" })).status,
			).toBe(409);
		}

		const input = {
			name: "Clean explainer",
			description: "Calm explainers",
			introTextPreset: "cinematic-title-intro",
			introEntrySfx: "soft swoosh accent",
			introEntrySfxUrl: "https://audio.test/section.mp3",
			introLeadInSec: 9,
			introTitleDurationSec: 30,
			introEntrySfxVolume: 0.45,
			introEntrySfxOffsetSec: 0.15,
			sectionGapSec: 0.8,
			sectionTitlePolicy: "every_section",
			sectionTextPreset: "section-card",
			sceneEntrySfx: "gentle interface tick",
			sceneEntrySfxUrl: "https://audio.test/scene.mp3",
			sentenceVoiceoverPauseSec: 0.2,
			sceneVoiceoverPauseSec: 0.45,
			maxVisualBeatSec: 4.5,
			maxVoiceoverSegmentSec: 7,
			staticSceneMovement: true,
			overrideSceneTransition: true,
			sceneTransition: "pixel",
			imageGuidancePrompt: "Show {{section.title}} with @Kitchen",
		};
		const created = await server.request("/timeline-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		expect(created.status).toBe(201);
		const item = ((await created.json()) as { item: typeof input & { id: string } }).item;
		expect(item).toMatchObject(input);

		const updated = await server.request(`/timeline-templates/${item.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...input, staticSceneMovement: false }),
		});
		expect(updated.status).toBe(200);
		expect(
			((await updated.json()) as { item: { staticSceneMovement: boolean } }).item
				.staticSceneMovement,
		).toBe(false);

		expect(
			(await server.request(`/timeline-templates/${item.id}`, { method: "DELETE" })).status,
		).toBe(200);
		expect((await server.request(`/timeline-templates/${item.id}`)).status).toBe(404);
	});

	/* Shipped templates were editable in place until they became fixtures — only DELETE
	 * was refused. This is the behaviour that changed for an existing client, so it is
	 * asserted directly rather than left to the preset suite. */
	test("a fixture template refuses an in-place edit and forks instead", async () => {
		const server = app();
		const items = (
			(await (await server.request("/timeline-templates")).json()) as { items: TimelineTemplate[] }
		).items;
		const fixture = items.find((item) => item.slug === DEFAULT_TIMELINE_TEMPLATE_SLUG)!;
		const body = { ...DEFAULT_TIMELINE_TEMPLATE, name: "Hijacked" };

		const refused = await server.request(`/timeline-templates/${fixture.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		expect(refused.status).toBe(409);
		expect(((await refused.json()) as { error: string }).error).toBe("fixture_row_requires_fork");

		const forked = await server.request(`/timeline-templates/${fixture.id}/fork`, {
			method: "POST",
		});
		expect(forked.status).toBe(201);
		const copy = ((await forked.json()) as { item: TimelineTemplate }).item;
		expect(copy.id).not.toBe(fixture.id);
		expect(copy.source).toBe("user");
		expect(copy.name).toBe(`${fixture.name} (copy)`);

		// The copy takes the edit the fixture refused, and the fixture is untouched.
		const patched = await server.request(`/timeline-templates/${copy.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		expect(patched.status).toBe(200);
		const after = (await (await server.request(`/timeline-templates/${fixture.id}`)).json()) as {
			item: TimelineTemplate;
		};
		expect(after.item.name).toBe(fixture.name);
	});

	test("rejects malformed templates", async () => {
		const response = await app().request("/timeline-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "" }),
		});
		expect(response.status).toBe(400);
	});

	test("rejects an invalid direct write before it can poison template reads", async () => {
		const invalid = {
			...DEFAULT_TIMELINE_TEMPLATE,
			name: "Invalid",
			maxVisualBeatSec: 20,
		} as TimelineTemplateInput;
		expect(() => createContentTimelineTemplate(invalid)).toThrow();
		expect(
			(await listContentTimelineTemplates())
				.map((item) => item.slug)
				.sort((a, b) => (a ?? "").localeCompare(b ?? "")),
		).toEqual(
			TIMELINE_TEMPLATE_FIXTURES.map((fixture) => fixture.slug).sort((a, b) => a.localeCompare(b)),
		);
		const defaultId = (await listContentTimelineTemplates()).find(
			(item) => item.slug === DEFAULT_TIMELINE_TEMPLATE_SLUG,
		)!.id;
		expect(() => updateContentTimelineTemplate(defaultId, invalid)).toThrow();
		expect(
			(await listContentTimelineTemplates()).find((item) => item.id === defaultId)
				?.maxVisualBeatSec,
		).toBe(DEFAULT_TIMELINE_TEMPLATE.maxVisualBeatSec);
		const server = app();
		expect(
			(
				await server.request("/timeline-templates", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(invalid),
				})
			).status,
		).toBe(400);
		// A fixture refuses the write before the body is even parsed, so this is a 409
		// naming the fork step rather than the 400 an operator row would answer with.
		expect(
			(
				await server.request(`/timeline-templates/${defaultId}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(invalid),
				})
			).status,
		).toBe(409);
	});

	test("resolves real preview SFX for the WYSIWYG editor", async () => {
		setStockAudioResolverForTests(async (kind, cue) => ({
			url: `https://audio.test/${kind}.mp3`,
			title: cue,
			durationSec: 1.4,
		}));
		const response = await app().request("/timeline-templates/preview-sfx?cue=soft%20swoosh");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			audio: { url: "https://audio.test/accent_hit.mp3", title: "soft swoosh", durationSec: 1.4 },
		});
	});

	test("resolves a preview background-music cue", async () => {
		setStockAudioResolverForTests(async (kind, cue) => ({
			url: `https://audio.test/${kind}.mp3`,
			title: cue,
			durationSec: 62,
		}));
		const response = await app().request(
			"/timeline-templates/preview-music?cue=dark%20driving%20pulse",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			audio: { url: "https://audio.test/music.mp3", title: "dark driving pulse", durationSec: 62 },
		});
	});

	test("returns nothing for an empty music cue without hitting the provider", async () => {
		let calls = 0;
		setStockAudioResolverForTests(async () => {
			calls++;
			return { url: "https://audio.test/music.mp3" };
		});
		const response = await app().request("/timeline-templates/preview-music?cue=%20%20");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ audio: null });
		expect(calls).toBe(0);
	});

	test("returns nothing when a music cue matches no track", async () => {
		setStockAudioResolverForTests(async () => null);
		const response = await app().request(
			"/timeline-templates/preview-music?cue=nonexistent%20genre",
		);
		expect(await response.json()).toEqual({ audio: null });
	});

	test("persists the background-music fields on a template", async () => {
		const server = app();
		const input = {
			...DEFAULT_TIMELINE_TEMPLATE,
			name: "Emotional score",
			musicCue: "warm underscore",
			musicUrl: "https://audio.test/pinned.mp3",
			musicVolume: 0.6,
			musicPolicy: "per_emotion" as const,
			musicEmotionCues: {
				tension: { cue: "dark driving pulse", url: "" },
				hope: { cue: "hopeful ambient", url: "https://audio.test/hope.mp3" },
			},
		};
		const created = await server.request("/timeline-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		expect(created.status).toBe(201);
		const item = ((await created.json()) as { item: typeof input & { id: string } }).item;
		expect(item.musicCue).toBe("warm underscore");
		expect(item.musicUrl).toBe("https://audio.test/pinned.mp3");
		expect(item.musicVolume).toBe(0.6);
		expect(item.musicPolicy).toBe("per_emotion");
		expect(item.musicEmotionCues).toEqual(input.musicEmotionCues);
		expect(item.musicEmotionCues.hope!.url).toBe("https://audio.test/hope.mp3");

		const reread = await server.request(`/timeline-templates/${item.id}`);
		expect(((await reread.json()) as { item: typeof input }).item.musicEmotionCues).toEqual(
			input.musicEmotionCues,
		);
	});

	test("falls back to a searchable cue when a descriptive template cue misses", async () => {
		const queries: string[] = [];
		setStockAudioResolverForTests(async (_kind, cue) => {
			queries.push(cue);
			return cue === "transition stinger" ? { url: "https://audio.test/stinger.mp3" } : null;
		});
		const response = await app().request(
			"/timeline-templates/preview-sfx?cue=subtle%20transition%20stinger",
		);
		expect(await response.json()).toEqual({ audio: { url: "https://audio.test/stinger.mp3" } });
		expect(queries).toEqual(["subtle transition stinger", "transition stinger"]);
	});
});
