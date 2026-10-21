#!/usr/bin/env bun
/** Rust cutover proof: production API/Web/Inngest, real cookie and MCP key auth.
 * Disposable Postgres and synthetic projects; no external model or media provider.
 * Run after `bun scripts/editor-engine.mts build`. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { SCENE_TEXT_CLIP_MIGRATION_VERSION } from "@maleo/shared";
import { engineExecutor, instantiateEngineSync, type EditScope } from "@maleo/shared/editor";
import { readFileSync } from "node:fs";
import { freePort, startEmbeddedPostgres } from "../../../packages/db/src/db/pg-embedded.ts";

const root = resolve(import.meta.dir, "../../..");
const directory = await mkdtemp(join(tmpdir(), "maleo-connected-editor-"));
const postgres = await startEmbeddedPostgres({
	dir: join(directory, "postgres"),
	port: freePort(),
	ephemeral: true,
}).catch(async (error) => {
	await rm(directory, { recursive: true, force: true });
	throw error;
});
const apiPort = freePort(),
	webPort = freePort(),
	inngestPort = freePort();
const api = `http://127.0.0.1:${apiPort}`,
	web = `http://127.0.0.1:${webPort}`;
const serviceToken = "synthetic-connected-editor-proof";
const environment = {
	PATH: process.env.PATH!,
	TMPDIR: tmpdir(),
	NODE_ENV: "development",
	MALEO_DATABASE_URL: postgres.url("postgres"),
	MALEO_DATA_DIR: directory,
	MALEO_MEDIA_STORAGE_BACKEND: "local",
	MALEO_SERVICE_TOKEN: serviceToken,
	MALEO_API_PORT: String(apiPort),
	MALEO_API_URL: api,
	CACHE_DIR: join(directory, "cache"),
	INNGEST_BASE_URL: `http://127.0.0.1:${inngestPort}`,
};
const children: Array<{ name: string; process: ReturnType<typeof Bun.spawn> }> = [];
function start(
	name: string,
	cwd: string,
	command: string[],
	extra: Record<string, string> = {},
): void {
	children.push({
		name,
		process: Bun.spawn(command, {
			cwd,
			env: { ...environment, ...extra },
			stdout: Bun.file(join(directory, `${name}.log`)),
			stderr: Bun.file(join(directory, `${name}.log`)),
		}),
	});
}
async function ready(url: string): Promise<void> {
	for (let attempt = 0; attempt < 150; attempt++) {
		for (const child of children)
			if (child.process.exitCode != null)
				throw new Error(
					`${child.name} stopped: ${await Bun.file(join(directory, `${child.name}.log`)).text()}`,
				);
		try {
			if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
		} catch {
			/* booting */
		}
		await Bun.sleep(200);
	}
	throw new Error(`Service did not become ready: ${url}`);
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
	start("api", join(root, "apps/api"), [process.execPath, "--no-env-file", "src/index.ts"]);
	start("inngest", directory, [
		join(root, "node_modules/.bin/inngest"),
		"dev",
		"--host",
		"127.0.0.1",
		"--port",
		String(inngestPort),
		"--no-discovery",
		"--connect-gateway-port",
		String(freePort()),
		"--connect-gateway-grpc-port",
		String(freePort()),
		"--connect-executor-grpc-port",
		String(freePort()),
		"-u",
		`${api}/api/inngest`,
	]);
	await Promise.all([
		ready(`${api}/api/auth-state`),
		ready(`${environment.INNGEST_BASE_URL}/health`),
	]);
	const registration = await fetch(`${api}/api/inngest`, { method: "PUT" });
	assert.equal(registration.status, 200, await registration.text());
	start("web", join(root, "apps/web"), [process.execPath, "--no-env-file", "src/app/serve.ts"], {
		NODE_ENV: "production",
		MALEO_WEB_PORT: String(webPort),
		MALEO_API_URLS: "",
	});
	await ready(web);
	assert.equal((await fetch(`${api}/api/operations/projects`)).status, 401);
	const signedIn = await fetch(`${api}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: api },
		body: JSON.stringify({
			name: "Synthetic Rust operator",
			email: "rust-proof@example.com",
			password: "synthetic-rust-proof-password-123",
		}),
	});
	assert.equal(signedIn.status, 200, await signedIn.clone().text());
	const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
	const headers = { cookie, "content-type": "application/json", origin: api };
	const keyResponse = await fetch(`${api}/api/auth/api-key/create`, {
		method: "POST",
		headers,
		body: JSON.stringify({ name: "Synthetic Rust proof" }),
	});
	assert.equal(keyResponse.status, 200, await keyResponse.clone().text());
	const key: string = (await keyResponse.json()).key;
	let rollbackProjectId = "";
	let rollbackDocument: unknown;
	let rpcId = 0;
	async function rpc(name: string, args: unknown, allowError = false) {
		const response = await fetch(`${api}/api/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${key}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: ++rpcId,
				method: "tools/call",
				params: { name, arguments: args },
			}),
			signal: AbortSignal.timeout(150000),
		});
		assert.equal(response.status, 200, await response.clone().text());
		const value = await response.json();
		assert.equal(value.error, undefined, JSON.stringify(value));
		if (!allowError) assert.equal(value.result.isError, undefined, JSON.stringify(value));
		const text = value.result.content[0].text;
		return allowError ? value.result : JSON.parse(text);
	}
	const clip = (id: number, name: string) => ({
		id: `scene:${id}`,
		type: "image",
		startSec: (id - 1) * 4,
		durationSec: 4,
		track: -1,
		futureField: { preserved: 0.1 },
		scene: {
			id,
			name,
			shot: "Wide",
			move: "Static",
			transition: "fade",
			vis: "",
			vo: "",
			dur: 4,
			img: false,
		},
	});
	const engine = instantiateEngineSync(
		readFileSync(
			join(root, "target/wasm32-unknown-unknown/release/maleo_editor_wasm.optimized.wasm"),
		),
	);
	browser = await chromium.launch();
	for (const width of [1440, 320]) {
		const created = await fetch(`${api}/api/operations/projects`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				title: `Synthetic Rust cutover ${width}`,
				type: "video",
				target_format: "16:9",
				seed_storyboard: {
					storyboard_json: {
						schemaVersion: 2,
						sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
						clips: [clip(1, "Opening"), clip(2, "Closing")],
						markers: [],
						bookmarks: [{ id: "kept", timeSec: 2, label: "Keep" }],
					},
				},
			}),
		});
		assert.equal(created.status, 201, await created.clone().text());
		const id: string = (await created.json()).project.project.id;
		const detail = async () =>
			(
				await fetch(`${api}/api/operations/projects/${id}?storyboard_limit=all`, { headers })
			).json();
		const latest = async () => (await detail()).storyboards[0].storyboard_json;
		const save = async (doc: unknown) => {
			const response = await fetch(`${api}/api/operations/projects/${id}/storyboards`, {
				method: "POST",
				headers,
				body: JSON.stringify({ storyboard_json: doc }),
			});
			assert.equal(response.status, 201, await response.text());
		};
		const invalid = await rpc(
			"update_scene",
			{ projectId: id, index: "invalid", name: "Refused" },
			true,
		);
		assert.equal(invalid.isError, true);
		const original = await latest();
		const started = await rpc("update_scene", { projectId: id, index: 0, name: "Agent opening" });
		console.log(JSON.stringify({ width, pending: started.status, action: started.pendingAction }));
		assert.equal(started.status, "awaiting_input");
		assert.ok(started.pendingAction);
		const manual = {
			...original,
			clips: original.clips.map((c: { id: string; scene: object }) =>
				c.id === "scene:2" ? { ...c, scene: { ...c.scene, name: "Manual closing" } } : c,
			),
		};
		await save(manual);
		const context = await browser.newContext({
			baseURL: web,
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			const split = cookie.indexOf("=");
			await context.addCookies([
				{
					name: cookie.slice(0, split),
					value: cookie.slice(split + 1),
					domain: "127.0.0.1",
					path: "/",
					httpOnly: true,
					sameSite: "Lax",
				},
			]);
			const page = await context.newPage(),
				errors: string[] = [];
			page.setDefaultTimeout(15000);
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(`/content/${id}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			if (width === 320) await page.getByRole("tab", { name: "Chat", exact: true }).click();
			await page
				.getByRole("button", { name: "Approve & generate", exact: true })
				.click({ timeout: 15000 });
			await expect
				.poll(async () => (await rpc("get_run", { runId: started.runId })).status, {
					timeout: 90000,
				})
				.toMatch(/^(done|error)$/);
			const settled = await rpc("get_run", { runId: started.runId });
			assert.equal(settled.status, "done", JSON.stringify(settled));
			await expect
				.poll(
					async () =>
						(await latest()).clips.find((c: { id: string }) => c.id === "scene:1").scene.name,
					{
						timeout: 15000,
					},
				)
				.toBe("Agent opening");
			assert.equal(
				(await latest()).clips.find((c: { id: string }) => c.id === "scene:2").scene.name,
				"Manual closing",
			);
			// Same commands through the web executor reproduce the server result.
			const chat = await (
				await fetch(`${api}/api/operations/projects/${id}/chat/${started.runId}`, { headers })
			).json();
			assert.ok(chat.commands?.length, JSON.stringify(chat));
			let scope: EditScope = { doc: manual, mediaAssets: [], slides: [], posts: [] };
			const executor = engineExecutor(engine);
			for (const command of chat.commands) scope = executor.execute(scope, command).scope;
			assert.deepEqual((await latest()).clips, scope.doc.clips);
			if (width === 320) await page.getByRole("tab", { name: "Editor", exact: true }).click();
			await expect(page.locator('button[aria-label="Undo"][title]'))
				.toBeEnabled({ timeout: 15000 })
				.catch(async (error) => {
					console.log(JSON.stringify({ ui: await page.locator("body").innerText() }));
					throw error;
				});
			await page.locator('button[aria-label="Undo"][title]').click();
			await expect
				.poll(
					async () =>
						(await latest()).clips.find((c: { id: string }) => c.id === "scene:1").scene.name,
				)
				.toBe("Opening");
			assert.equal(
				(await latest()).clips.find((c: { id: string }) => c.id === "scene:2").scene.name,
				"Manual closing",
			);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect
				.poll(
					async () =>
						(await latest()).clips.find((c: { id: string }) => c.id === "scene:1").scene.name,
				)
				.toBe("Agent opening");
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const reloaded = await latest();
			assert.equal(reloaded.clips.filter((c: { id: string }) => c.id === "scene:1").length, 1);
			assert.deepEqual(reloaded.clips[0].futureField, original.clips[0].futureField);
			assert.deepEqual(reloaded.bookmarks, original.bookmarks);
			assert.deepEqual(errors, []);
		} finally {
			await context.close();
		}
		// Conflict on the same clip: preserve manual save, refuse agent overwrite.
		const conflict = await rpc("update_scene", {
			projectId: id,
			index: 0,
			name: "Conflicting agent",
		});
		assert.equal(conflict.status, "awaiting_input");
		const beforeConflict = await latest();
		const protectedDoc = {
			...beforeConflict,
			clips: beforeConflict.clips.map((c: { id: string; scene: object }) =>
				c.id === "scene:1" ? { ...c, scene: { ...c.scene, name: "Protected manual" } } : c,
			),
		};
		await save(protectedDoc);
		await rpc("answer_action", {
			runId: conflict.runId,
			actionId: conflict.pendingAction.actionId,
			answer: "Approve",
		});
		await expect
			.poll(async () => (await rpc("get_run", { runId: conflict.runId })).status, {
				timeout: 90000,
			})
			.toMatch(/^(done|error)$/);
		assert.deepEqual(await latest(), protectedDoc);
		const conflictChat = await (
			await fetch(`${api}/api/operations/projects/${id}/chat/${conflict.runId}`, { headers })
		).json();
		assert.ok(conflictChat.commandConflict?.includes("scene:1"), JSON.stringify(conflictChat));
		// Roll back by publishing a preserved compatible revision through the normal writer.
		await save(original);
		const restored = await latest();
		assert.deepEqual(restored.clips, original.clips);
		assert.deepEqual(restored.markers, original.markers);
		assert.deepEqual(restored.bookmarks, original.bookmarks);
		rollbackProjectId = id;
		rollbackDocument = restored;
		console.log(
			JSON.stringify({
				width,
				cookieAuth: true,
				apiKeyMcp: true,
				invalidInputRefused: true,
				serverClientParity: true,
				manualSaveRebased: true,
				conflictNoOverwrite: true,
				settledUndoRedo: true,
				reloadNoDuplicate: true,
				legacyFieldsPreserved: true,
				preservedRevisionRollback: true,
			}),
		);
	}
	// Exercise the previously verified application build against the preserved revision.
	const priorRoot = join(directory, "prior-build");
	await mkdir(priorRoot);
	const priorCommit = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	execFileSync("tar", ["-xf", "-", "-C", priorRoot], {
		input: execFileSync("git", ["archive", "HEAD"], { cwd: root, maxBuffer: 128 * 1024 * 1024 }),
	});
	execFileSync(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts"], {
		cwd: priorRoot,
		timeout: 60000,
		stdio: "pipe",
	});
	const artifact = "target/wasm32-unknown-unknown/release/maleo_editor_wasm.optimized.wasm";
	const priorArtifact = readFileSync(join(priorRoot, "scripts/editor-engine.mts"), "utf8").match(
		/target\/wasm32-unknown-unknown\/release\/[^"\s]+\.optimized\.wasm/,
	)?.[0];
	assert.ok(priorArtifact, "prior build declares its own artifact path");
	const priorName: string = JSON.parse(readFileSync(join(priorRoot, "package.json"), "utf8")).name;
	const priorPrefix = `${priorName.replace(/-mono$/, "").toUpperCase()}_`;
	// Historical rollback uses that release's configuration, never current-runtime aliases.
	const priorEnvironment = Object.fromEntries(
		Object.entries(environment).map(([name, value]) => [
			name.replace(/^MALEO_/, priorPrefix),
			value,
		]),
	);
	await mkdir(join(priorRoot, "target/wasm32-unknown-unknown/release"), { recursive: true });
	await copyFile(join(root, artifact), join(priorRoot, priorArtifact));
	for (const name of ["web", "api"]) {
		const index = children.findIndex((child) => child.name === name);
		const [child] = children.splice(index, 1);
		child!.process.kill();
		await child!.process.exited;
	}
	start(
		"api",
		join(priorRoot, "apps/api"),
		[process.execPath, "--no-env-file", "src/index.ts"],
		priorEnvironment,
	);
	start(
		"web",
		join(priorRoot, "apps/web"),
		[process.execPath, "--no-env-file", "src/app/serve.ts"],
		{
			...priorEnvironment,
			NODE_ENV: "production",
			[`${priorPrefix}WEB_PORT`]: String(webPort),
			[`${priorPrefix}API_URLS`]: "",
		},
	);
	await Promise.all([ready(`${api}/api/auth-state`), ready(web)]);
	const rolledBack = await (
		await fetch(`${api}/api/operations/projects/${rollbackProjectId}`, { headers })
	).json();
	assert.deepEqual(rolledBack.storyboards[0].storyboard_json, rollbackDocument);
	const context = await browser.newContext({
		baseURL: web,
		viewport: { width: 1440, height: 900 },
	});
	try {
		const split = cookie.indexOf("=");
		await context.addCookies([
			{
				name: cookie.slice(0, split),
				value: cookie.slice(split + 1),
				domain: "127.0.0.1",
				path: "/",
				httpOnly: true,
				sameSite: "Lax",
			},
		]);
		const page = await context.newPage(),
			errors: string[] = [];
		page.setDefaultTimeout(15000);
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`/content/${rollbackProjectId}`);
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		await expect(page.locator('[data-clipid="scene:1"]')).toBeVisible();
		await expect(page.locator('[data-clipid="scene:2"]')).toBeVisible();
		await page.reload();
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		await expect(page.locator('[data-clipid="scene:1"]')).toBeVisible();
		assert.deepEqual(errors, []);
		console.log(
			JSON.stringify({
				previousBuild: priorCommit,
				preservedRevisionOpened: true,
				currentWritersStopped: true,
			}),
		);
	} finally {
		await context.close();
	}
} catch (error) {
	for (const child of children)
		console.error(
			`${child.name}: ${(await Bun.file(join(directory, `${child.name}.log`)).text()).split("\n").slice(-12).join("\n")}`,
		);
	throw error;
} finally {
	await browser?.close();
	for (const child of children.reverse()) {
		child.process.kill();
		await child.process.exited;
	}
	await postgres.stop();
	await rm(directory, { recursive: true, force: true });
}
