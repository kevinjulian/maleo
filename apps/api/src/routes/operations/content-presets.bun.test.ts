import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { findPresetFixture, type StyleKnobs } from "@maleo/shared";

const knobs = (styleId: string): StyleKnobs => findPresetFixture(styleId)!.bundle.style!;
import { PRESET_FIXTURES } from "@maleo/shared";
import type { ContentPreset, ContentPresetInput } from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import {
	createContentPreset,
	getDefaultContentPresetId,
	setDefaultContentPresetId,
} from "@maleo/db/content-presets";
import { registerContentPresetRoutes } from "./content-presets.ts";
import { presetBundle } from "@maleo/shared";

const dbPath = join(tmpdir(), "maleo-content-preset-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	registerContentPresetRoutes(instance);
	return instance;
}

const json = { "content-type": "application/json" };
const sample: ContentPresetInput = {
	name: "Studio look",
	description: "Warm documentary defaults",
	bundle: presetBundle({
		style: knobs("dark-documentary"),
		projectRefs: {
			prompt: "warm",
			mediaAssetIds: [],
			imageIds: ["img-1"],
			noteIds: [],
			productIds: [],
		},
		settings: { aspectRatio: "16:9", voice: "Kore" },
		pacingDevices: { chapterPills: true },
		infographicStyle: { bgColor: "#123456" },
	}),
};

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("content preset routes", () => {
	test("create, list, update, delete round-trip", async () => {
		const server = app();

		const empty = (await (await server.request("/content-presets")).json()) as {
			items: ContentPreset[];
			defaultId: string | null;
		};
		// Fixtures are bootstrapped rows now rather than code merged in on read, so a
		// workspace that has saved nothing still has presets to pick.
		expect(empty.items.length).toBe(PRESET_FIXTURES.length);
		expect(empty.items.every((i) => i.source === "fixture")).toBe(true);
		expect(empty.defaultId).toBeNull();

		const created = await server.request("/content-presets", {
			method: "POST",
			headers: json,
			body: JSON.stringify(sample),
		});
		expect(created.status).toBe(201);
		const item = ((await created.json()) as { item: ContentPreset }).item;
		expect(item.name).toBe("Studio look");
		expect(item.bundle.style).toEqual(knobs("dark-documentary"));

		const patched = await server.request(`/content-presets/${item.id}`, {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ ...sample, name: "Renamed" }),
		});
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as { item: { name: string } }).item.name).toBe("Renamed");

		expect((await server.request(`/content-presets/${item.id}`, { method: "DELETE" })).status).toBe(
			200,
		);
		expect((await server.request(`/content-presets/${item.id}`)).status).toBe(404);
	});

	test("single default replaces the previous one", async () => {
		const server = app();
		const a = await createContentPreset(sample);
		const b = await createContentPreset({ ...sample, name: "Second" });

		await server.request("/content-presets/default", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ id: a.id }),
		});
		expect(await getDefaultContentPresetId()).toBe(a.id);

		const res = await server.request("/content-presets/default", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ id: b.id }),
		});
		expect(((await res.json()) as { defaultId: string }).defaultId).toBe(b.id);
		expect(await getDefaultContentPresetId()).toBe(b.id);

		const list = (await (await server.request("/content-presets")).json()) as { defaultId: string };
		expect(list.defaultId).toBe(b.id);
	});

	test("deleting the default clears the pointer", async () => {
		const server = app();
		const a = await createContentPreset(sample);
		await setDefaultContentPresetId(a.id);
		expect(await getDefaultContentPresetId()).toBe(a.id);

		await server.request(`/content-presets/${a.id}`, { method: "DELETE" });
		expect(await getDefaultContentPresetId()).toBeNull();
	});

	test("setting a non-existent default is rejected", async () => {
		const res = await app().request("/content-presets/default", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ id: "does-not-exist" }),
		});
		expect(res.status).toBe(404);
	});

	test("rejects a preset without a name", async () => {
		const res = await app().request("/content-presets", {
			method: "POST",
			headers: json,
			body: JSON.stringify({ ...sample, name: "" }),
		});
		expect(res.status).toBe(400);
	});

	test("clearing the default with a null id is allowed", async () => {
		const server = app();
		const a = await createContentPreset(sample);
		await setDefaultContentPresetId(a.id);
		const res = await server.request("/content-presets/default", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ id: null }),
		});
		expect(res.status).toBe(200);
		expect(await getDefaultContentPresetId()).toBeNull();
	});
	/* Fixtures are read-only. Enforcing that at the boundary rather than in each UI
	 * action means a missed branch 409s instead of rewriting a shipped row. */
	async function fixtureId(server: Hono): Promise<string> {
		const list = (await (await server.request("/content-presets")).json()) as {
			items: ContentPreset[];
		};
		return list.items.find((item) => item.source === "fixture")!.id;
	}

	test("a fixture cannot be updated or deleted", async () => {
		const server = app();
		const id = await fixtureId(server);
		const patched = await server.request(`/content-presets/${id}`, {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ ...sample, name: "Hijacked" }),
		});
		expect(patched.status).toBe(409);
		// The refusal names the next call rather than just saying no.
		expect(((await patched.json()) as { error: string; fork: string }).error).toBe(
			"fixture_row_requires_fork",
		);
		const deleted = await server.request(`/content-presets/${id}`, { method: "DELETE" });
		expect(deleted.status).toBe(409);
		// And the fixture is still intact.
		const got = await server.request(`/content-presets/${id}`);
		expect(got.status).toBe(200);
		expect(((await got.json()) as { item: ContentPreset }).item.name).toBe(
			PRESET_FIXTURES[0]!.name,
		);
	});

	test("forking a fixture copies it without touching the original", async () => {
		const server = app();
		const id = await fixtureId(server);
		const before = (await (await server.request(`/content-presets/${id}`)).json()) as {
			item: ContentPreset;
		};

		const forked = await server.request(`/content-presets/${id}/fork`, { method: "POST" });
		expect(forked.status).toBe(201);
		const copy = ((await forked.json()) as { item: ContentPreset }).item;

		expect(copy.id).not.toBe(id);
		expect(copy.source).toBe("user");
		expect(copy.name).toBe(`${before.item.name} (copy)`);
		// The copy references the SAME fixture materials and template: forking a preset
		// does not clone the library behind it.
		expect(copy.bundle.materials).toEqual(before.item.bundle.materials);
		expect(copy.bundle.videoTemplateId).toBe(before.item.bundle.videoTemplateId);

		const after = (await (await server.request(`/content-presets/${id}`)).json()) as {
			item: ContentPreset;
		};
		expect(after.item.name).toBe(before.item.name);
	});

	test("a second fork of the same fixture takes the next free name", async () => {
		const server = app();
		const id = await fixtureId(server);
		const first = (
			(await (await server.request(`/content-presets/${id}/fork`, { method: "POST" })).json()) as {
				item: ContentPreset;
			}
		).item;
		const second = (
			(await (await server.request(`/content-presets/${id}/fork`, { method: "POST" })).json()) as {
				item: ContentPreset;
			}
		).item;

		expect(second.id).not.toBe(first.id);
		expect(second.name).toBe(`${PRESET_FIXTURES[0]!.name} (copy 2)`);
	});

	test("the copy created by a fork is editable", async () => {
		const server = app();
		const id = await fixtureId(server);
		const copy = (
			(await (await server.request(`/content-presets/${id}/fork`, { method: "POST" })).json()) as {
				item: ContentPreset;
			}
		).item;

		const patched = await server.request(`/content-presets/${copy.id}`, {
			method: "PATCH",
			headers: json,
			body: JSON.stringify({ ...sample, name: "Mine now" }),
		});
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as { item: ContentPreset }).item.name).toBe("Mine now");
	});

	test("forking the default preset does not move the default", async () => {
		const server = app();
		const id = await fixtureId(server);
		await setDefaultContentPresetId(id);

		await server.request(`/content-presets/${id}/fork`, { method: "POST" });
		expect(await getDefaultContentPresetId()).toBe(id);
	});

	test("a fixture may be the workspace default", async () => {
		const server = app();
		const id = await fixtureId(server);
		const res = await server.request("/content-presets/default", {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ id }),
		});
		expect(res.status).toBe(200);
		expect(await getDefaultContentPresetId()).toBe(id);
		// Pointing at a fixture writes no new row.
		const list = (await (await server.request("/content-presets")).json()) as {
			items: ContentPreset[];
		};
		expect(list.items.length).toBe(PRESET_FIXTURES.length);
	});

	test("fixtures are listed first, in shipped order, with workspace rows after", async () => {
		const server = app();
		const mine = await createContentPreset(sample);
		const list = (await (await server.request("/content-presets")).json()) as {
			items: ContentPreset[];
		};
		expect(list.items.length).toBe(PRESET_FIXTURES.length + 1);
		expect(list.items.slice(0, PRESET_FIXTURES.length).map((item) => item.slug)).toEqual(
			PRESET_FIXTURES.map((f) => f.slug),
		);
		expect(list.items[list.items.length - 1]!.id).toBe(mine.id);
	});
});

/* The usage route. It answers the two questions both the blast-radius warning and the
 * library's divergence view ask, from one derivation, so the two cannot disagree. */
describe("GET /content-presets/:id/usage", () => {
	test("a workspace preset with no projects reports zero", async () => {
		const created = await createContentPreset(sample);
		const res = await app().request(`/content-presets/${created.id}/usage`);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ using: 0, diverged: 0, projects: [] });
	});

	/* A fixture supplies elements exactly like an operator's preset, and "how many
	 * projects would a fork affect" is a fair question about one — so it answers rather
	 * than 404s. */
	test("a fixture answers too", async () => {
		const server = app();
		const list = (await (await server.request("/content-presets")).json()) as {
			items: ContentPreset[];
		};
		const fixture = list.items.find((item) => item.source === "fixture")!;
		const res = await server.request(`/content-presets/${fixture.id}/usage`);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ using: 0, diverged: 0, projects: [] });
	});

	test("an unknown id is a 404, not an empty answer", async () => {
		const res = await app().request("/content-presets/nope/usage");

		expect(res.status).toBe(404);
	});
});
