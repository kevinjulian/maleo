import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { settingsRoutes } from "./settings.ts";
import { capabilitiesRoutes } from "./capabilities.ts";
import { testApp } from "../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), "maleo-settings-provider-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const priorProvider = process.env.MALEO_PROVIDER_IMAGE;
const priorWorker = process.env.MALEO_GEN_WORKER_URL;
const priorSandbox = process.env.MALEO_SANDBOX;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	delete process.env.MALEO_PROVIDER_IMAGE;
	// The sandbox is opt-in so a misconfigured deploy cannot land on mock output.
	// These tests exercise the route's selection plumbing, and the mock is the only
	// provider guaranteed ready on a machine with no credentials, so they opt in.
	process.env.MALEO_SANDBOX = "1";
	process.env.MALEO_GEN_WORKER_URL = "http://media-worker.test";
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	if (priorProvider === undefined) delete process.env.MALEO_PROVIDER_IMAGE;
	else process.env.MALEO_PROVIDER_IMAGE = priorProvider;
	if (priorWorker === undefined) delete process.env.MALEO_GEN_WORKER_URL;
	else process.env.MALEO_GEN_WORKER_URL = priorWorker;
	if (priorSandbox === undefined) delete process.env.MALEO_SANDBOX;
	else process.env.MALEO_SANDBOX = priorSandbox;
});

describe("image provider settings route", () => {
	test("lists providers and persists sandbox selection", async () => {
		const app = testApp(settingsRoutes());
		const initial = await app.request("/image-provider");
		const initialBody = (await initial.json()) as Record<string, unknown>;
		expect(initial.status).toBe(200);
		expect(initialBody.effective_provider).not.toBeNull();
		expect(initialBody.providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "cloudflare-ai" }),
				expect.objectContaining({ id: "sandbox", health: "ready" }),
			]),
		);

		/* Written through the one capability endpoint — this route no longer takes
		 * a PUT. The projection it serves and the selection endpoint have to agree,
		 * which is exactly what this asserts: write there, read here. */
		const saved = await testApp(capabilitiesRoutes()).request("/image/provider", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ provider_id: "sandbox" }),
		});
		expect(saved.status).toBe(200);

		const after = await app.request("/image-provider");
		const savedBody = (await after.json()) as Record<string, unknown>;
		expect(savedBody.selected_provider).toBe("sandbox");
		expect(savedBody.effective_provider).toBe("sandbox");
		// "global", not "workspace": the choice is stored in `global_settings`,
		// whose primary key is `key` alone with no workspace column. Reporting it
		// as workspace-scoped is what made the UI label it "Workspace default",
		// a claim the schema never supported.
		expect(savedBody.source).toBe("global");
	});

	/* The picker renders whatever this route lists, so a provider missing here is a
	 * provider the operator cannot choose. Health is asserted loosely because it
	 * depends on whether the `codex` CLI exists on the machine running the suite. */
	test("offers codex in the picker with its own label", async () => {
		const body = (await (await testApp(settingsRoutes()).request("/image-provider")).json()) as {
			providers: Array<{ id: string; label: string; health: string }>;
		};
		const codex = body.providers.find((provider) => provider.id === "codex");
		if (!codex) throw new Error("codex provider missing from the picker");
		expect(codex.label).toBe("Codex Imagegen");
		expect(["ready", "unconfigured", "down"]).toContain(codex.health);
	});

	/* A row written before a provider was retired must not brick the capability.
	 * The route keeps reporting the stored id as `selected_provider`, so the
	 * operator can see WHY the effective provider differs from their choice
	 * rather than finding a picker that silently disagrees with itself. */
	test("recovers when the stored provider has been retired", async () => {
		const { setGlobalImageProvider } = await import("@maleo/db/global-settings");
		// Any id the registry does not know. Deliberately not a specific retired
		// name: the behaviour under test is "this id resolves to nothing", which is
		// what every future retirement looks like too.
		await setGlobalImageProvider("retired-provider");

		const body = (await (
			await testApp(settingsRoutes()).request("/image-provider")
		).json()) as Record<string, unknown>;
		expect(body.selected_provider).toBe("retired-provider");
		expect(body.effective_provider).not.toBeNull();
		expect(body.effective_provider).not.toBe("retired-provider");
		expect(body.selection_error).toBeNull();
	});

	test("rejects unknown providers", async () => {
		const response = await testApp(capabilitiesRoutes()).request("/image/provider", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ provider_id: "missing" }),
		});
		expect(response.status).toBe(400);
	});

	/* The route that used to take this write is gone. Asserted rather than
	 * assumed: a PUT that quietly 404s looks the same to a caller as one that
	 * succeeded and did nothing. */
	test("no longer accepts a write of its own", async () => {
		const response = await testApp(settingsRoutes()).request("/image-provider", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ provider_id: "sandbox" }),
		});
		expect(response.status).toBe(404);
	});
});
