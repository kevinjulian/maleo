import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { registerMotionPresetRoutes } from "./motion-presets.ts";

const dbPath = join(tmpdir(), "maleo-motion-preset-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	registerMotionPresetRoutes(instance);
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

const validInput = {
	name: "Punch in",
	keyframes: [
		{ t: 0, scale: 1, x: 0, y: 0, easing: "linear" },
		{ t: 1, scale: 1.2, x: 10, y: -8, rotate: 2, easing: "bezier" },
	],
};

describe("motion presets", () => {
	test("starts empty, then create / get / delete round-trips", async () => {
		const server = app();
		expect(
			((await (await server.request("/motion-presets")).json()) as { items: unknown[] }).items,
		).toHaveLength(0);

		const created = await server.request("/motion-presets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validInput),
		});
		expect(created.status).toBe(201);
		const item = ((await created.json()) as { item: typeof validInput & { id: string } }).item;
		expect(item).toMatchObject(validInput);
		expect(item.id).toBeTruthy();

		const list = (
			(await (await server.request("/motion-presets")).json()) as { items: Array<{ id: string }> }
		).items;
		expect(list).toHaveLength(1);

		expect((await server.request(`/motion-presets/${item.id}`)).status).toBe(200);
		expect((await server.request(`/motion-presets/${item.id}`, { method: "DELETE" })).status).toBe(
			200,
		);
		expect((await server.request(`/motion-presets/${item.id}`)).status).toBe(404);
	});

	test("updates an existing preset", async () => {
		const server = app();
		const created = await server.request("/motion-presets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validInput),
		});
		const item = ((await created.json()) as { item: { id: string } }).item;
		const updated = await server.request(`/motion-presets/${item.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...validInput, name: "Renamed" }),
		});
		expect(updated.status).toBe(200);
		expect(((await updated.json()) as { item: { name: string } }).item.name).toBe("Renamed");
	});

	test("rejects malformed presets (fewer than 2 keyframes)", async () => {
		const response = await app().request("/motion-presets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "x", keyframes: [{ t: 0, scale: 1, x: 0, y: 0 }] }),
		});
		expect(response.status).toBe(400);
	});

	test("404 on update of a missing preset", async () => {
		const response = await app().request("/motion-presets/nope", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validInput),
		});
		expect(response.status).toBe(404);
	});
});
