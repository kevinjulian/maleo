import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { registerClipTemplateRoutes } from "./clip-templates.ts";

const dbPath = join(tmpdir(), "maleo-clip-template-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	registerClipTemplateRoutes(instance);
	return instance;
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

const textInput = {
	kind: "text",
	label: "My Star",
	intent: "Brand shape",
	category: "shape",
	base: "shape-star",
	config: { fill: "transparent", stroke: "#FFFFFF", strokeWidth: 2 },
};

describe("clip templates", () => {
	test("empty, then create / list / get / delete", async () => {
		const server = app();
		expect(
			((await (await server.request("/clip-templates")).json()) as { items: unknown[] }).items,
		).toHaveLength(0);

		const created = await server.request("/clip-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(textInput),
		});
		expect(created.status).toBe(201);
		const item = ((await created.json()) as { item: typeof textInput & { id: string } }).item;
		expect(item).toMatchObject(textInput);

		expect(
			((await (await server.request("/clip-templates")).json()) as { items: unknown[] }).items,
		).toHaveLength(1);
		expect((await server.request(`/clip-templates/${item.id}`, { method: "DELETE" })).status).toBe(
			200,
		);
		expect((await server.request(`/clip-templates/${item.id}`)).status).toBe(404);
	});

	test("updates a template", async () => {
		const server = app();
		const created = await server.request("/clip-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(textInput),
		});
		const item = ((await created.json()) as { item: { id: string } }).item;
		const updated = await server.request(`/clip-templates/${item.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...textInput, label: "Renamed" }),
		});
		expect(updated.status).toBe(200);
		expect(((await updated.json()) as { item: { label: string } }).item.label).toBe("Renamed");
	});

	test("rejects retired bases without creating a record", async () => {
		const server = app();
		const result = await server.request("/clip-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...textInput, base: "rve-lower-third" }),
		});
		expect(result.status).toBe(400);
		expect((await (await server.request("/clip-templates")).json()).items).toEqual([]);
	});
	test("rejects invalid retained shape values", async () => {
		for (const config of [{ opacity: 2 }, { strokeWidth: -1 }, { radius: 3 }]) {
			const result = await app().request("/clip-templates", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...textInput, config }),
			});
			expect(result.status).toBe(400);
		}
	});
	test("rejects malformed (missing base)", async () => {
		const response = await app().request("/clip-templates", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "text", label: "x", category: "text", config: {} }),
		});
		expect(response.status).toBe(400);
	});
});
