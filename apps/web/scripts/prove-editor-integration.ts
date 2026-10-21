#!/usr/bin/env bun
/** Connected acceptance: real cookie auth, Postgres, worker and Inngest.
 * Run after `bun scripts/editor-engine.mts build`.
 * API/worker use explicit local development storage; web bundle is production.
 * Synthetic bytes only. No HAR responses, user database or configured providers.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { projectMaterialsSchema, type ClipLayout } from "@maleo/shared";
import { freePort, startEmbeddedPostgres } from "../../../packages/db/src/db/pg-embedded.ts";
import { pendingMediaFlow } from "./prove-pending-media.ts";
import { chooseOption } from "../visual/options.ts";

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
	workerPort = freePort(),
	webPort = freePort(),
	inngestPort = freePort(),
	videoPort = freePort();
const api = `http://127.0.0.1:${apiPort}`,
	worker = `http://127.0.0.1:${workerPort}`,
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
	MALEO_MEDIA_WORKER_PORT: String(workerPort),
	MALEO_GEN_WORKER_URL: worker,
	MALEO_API_URL: api,
	GEN_WORKER_DB: join(directory, "worker.sqlite"),
	CACHE_DIR: join(directory, "cache"),
	MALEO_VIDEO_URL: `http://127.0.0.1:${videoPort}`,
	MALEO_VIDEO_PORT: String(videoPort),
	MALEO_VIDEO_TOKEN: serviceToken,
	MALEO_VIDEO_DB: join(directory, "render.sqlite"),
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
const bytes = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", ...args]);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let speech: ReturnType<typeof Bun.serve> | undefined;
try {
	const image = bytes([
		"-f",
		"lavfi",
		"-i",
		"color=c=green:s=64x36",
		"-frames:v",
		"1",
		"-c:v",
		"png",
		"-f",
		"image2pipe",
		"pipe:1",
	]);
	const video = bytes([
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=64x36:r=30:d=8",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:sample_rate=48000:duration=8",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const mobileVideo = bytes([
		"-f",
		"lavfi",
		"-i",
		"color=c=0x0008ff:s=64x36:r=30:d=8",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:sample_rate=48000:duration=8",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const audio = bytes([
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=8",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	// Synthetic speech bytes exercise real preparation without external providers.
	const narration = bytes([
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=220:duration=4",
		"-bitexact",
		"-f",
		"wav",
		"pipe:1",
	]);
	const generated = bytes([
		"-f",
		"lavfi",
		"-i",
		"color=c=black:s=64x36",
		"-frames:v",
		"1",
		"-c:v",
		"png",
		"-f",
		"image2pipe",
		"pipe:1",
	]);
	const speechServer = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === "/v1/audio/speech" && request.method === "POST")
				return new Response(narration, { headers: { "content-type": "audio/wav" } });
			if (pathname === "/generated-base.png" && request.method === "GET")
				return new Response(generated, { headers: { "content-type": "image/png" } });
			return new Response(null, { status: 404 });
		},
	});
	speech = speechServer;
	const renderDirectory = join(directory, "renderer");
	await mkdir(join(renderDirectory, "public"), { recursive: true });
	await symlink(join(root, "node_modules"), join(renderDirectory, "node_modules"));
	// Install renderer's native browser before timing the production render job.
	const installed = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			join(root, "packages/video/node_modules/@remotion/cli/remotion-cli.js"),
			"browser",
			"ensure",
		],
		{
			cwd: renderDirectory,
			env: environment,
			stdout: Bun.file(join(directory, "browser-install.log")),
			stderr: Bun.file(join(directory, "browser-install.log")),
		},
	);
	const installDeadline = setTimeout(() => installed.kill(), 300000);
	try {
		assert.equal(
			await installed.exited,
			0,
			await Bun.file(join(directory, "browser-install.log")).text(),
		);
	} finally {
		clearTimeout(installDeadline);
	}
	start(
		"video",
		renderDirectory,
		[process.execPath, "--no-env-file", join(root, "apps/render-worker/src/index.ts")],
		{
			MALEO_TTS_PROVIDER: "kokoro",
			MALEO_KOKORO_URL: `http://127.0.0.1:${speechServer.port}`,
		},
	);
	start("api", join(root, "apps/api"), [process.execPath, "--no-env-file", "src/index.ts"]);
	start(
		"worker",
		join(root, "apps/media-worker"),
		[process.execPath, "--no-env-file", "src/index.ts"],
		{ INNGEST_APP_ID: "maleo-media" },
	);
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
		`${worker}/api/inngest`,
	]);
	await Promise.all([
		ready(`${api}/api/auth-state`),
		ready(`${worker}/health`),
		ready(`${environment.INNGEST_BASE_URL}/health`),
		ready(`${environment.MALEO_VIDEO_URL}/health`),
	]);
	// Health does not prove that Inngest has registered the processing function.
	const registration = await fetch(`${worker}/api/inngest`, { method: "PUT" });
	assert.equal(registration.status, 200, await registration.text());
	const health = await (await fetch(`${worker}/health`)).json();
	assert.equal(health.processing.available, true);
	assert.equal((await fetch(`${worker}/processing/readiness`)).status, 401);
	assert.equal(
		(
			await fetch(`${worker}/processing/readiness`, {
				headers: { authorization: `Bearer ${serviceToken}` },
			})
		).status,
		200,
	);
	start("web", join(root, "apps/web"), [process.execPath, "--no-env-file", "src/app/serve.ts"], {
		NODE_ENV: "production",
		MALEO_WEB_PORT: String(webPort),
		MALEO_API_URLS: "",
	});
	await ready(web);
	const agentFixture = join(directory, "agent-fixture.ts");
	await Bun.write(
		agentFixture,
		`
import { buildAgentJob } from ${JSON.stringify(join(root, "apps/api/src/modules/agents/core/run-bracket.ts"))};
import { saveRun } from ${JSON.stringify(join(root, "apps/api/src/modules/agents/core/run-repository.ts"))};
import { getMediaObject } from ${JSON.stringify(join(root, "packages/db/src/db/media-objects.ts"))};
import { deleteMedia } from ${JSON.stringify(join(root, "packages/storage/src/storage.ts"))};
import { upsertReferenceEntity } from ${JSON.stringify(join(root, "packages/db/src/db/references.ts"))};
const [action, projectId, statePath] = process.argv.slice(2);
if (action === "reference") {
 const reference = await upsertReferenceEntity({ id: "synthetic-reference-" + projectId, workspace: "default", role: "character", label: "Synthetic reference " + projectId, canonical_image_url: statePath, origin: "generated" });
 if (!reference) throw new Error("Fixture reference could not be stored");
 process.exit(0);
}
if (action === "remove") {
 const media = await getMediaObject(statePath);
 if (!media || media.workspace !== "default" || !media.storage_key.startsWith("workspaces/default/video/" + projectId + "/")) throw new Error("Fixture source is outside its isolated project");
 await deleteMedia(media.storage_key);
 process.exit(0);
}
const job = action === "seed" ? await buildAgentJob({ projectId, instruction: "Change narration only", aspect: "16:9" }) : await Bun.file(statePath).json();
job.scenes[0].voiceover = "Edited narration";
job.events = [{ kind: "storyboard_patch" }];
if (action === "finish") { job.status = "done"; job.events.push({ kind: "final", text: "Synthetic narration edit complete" }); }
await saveRun(job);
await Bun.write(statePath, JSON.stringify(job));
process.exit(0);
`,
	);
	const launched = await chromium.launch();
	browser = launched;
	for (const width of [1440, 320]) {
		const context = await launched.newContext({
			baseURL: web,
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			assert.equal((await fetch(`${api}/api/operations/projects`)).status, 401);
			const signedIn = await fetch(
				`${api}/api/auth/${width === 1440 ? "sign-up" : "sign-in"}/email`,
				{
					method: "POST",
					headers: { "content-type": "application/json", origin: api },
					body: JSON.stringify({
						name: "Synthetic operator",
						email: "editor-proof@example.com",
						password: "synthetic-proof-password-123",
					}),
				},
			);
			assert.equal(signedIn.status, 200, await signedIn.clone().text());
			const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
			const separator = cookie.indexOf("=");
			await context.addCookies([
				{
					name: cookie.slice(0, separator),
					value: cookie.slice(separator + 1),
					domain: "127.0.0.1",
					path: "/",
					httpOnly: true,
					sameSite: "Lax",
				},
			]);
			assert.equal(
				(await (await fetch(`${api}/api/auth/get-session`, { headers: { cookie } })).json()).user
					.email,
				"editor-proof@example.com",
			);
			const created = await fetch(`${api}/api/operations/projects`, {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({
					title: `Synthetic connected editor ${width}`,
					type: "video",
					target_format: "16:9",
					target_duration_sec: 4,
					seed_storyboard: {
						storyboard_json: {
							schemaVersion: 2,
							markers: [],
							clips: [
								{
									id: "scene:1",
									type: "image",
									startSec: 0,
									durationSec: 4,
									track: -1,
									scene: {
										id: 1,
										sectionId: "proof-chapter",
										name: "Synthetic generated base",
										shot: "Wide",
										move: "Static",
										vis: "",
										vo: "Original narration",
										dur: 4,
										src: `http://127.0.0.1:${speechServer.port}/generated-base.png`,
									},
								},
							],
						},
					},
				}),
			});
			assert.equal(created.status, 201, await created.clone().text());
			const id: string = (await created.json()).project.project.id;
			const detail = async () =>
				(await fetch(`${api}/api/operations/projects/${id}`, { headers: { cookie } })).json();
			const referenceId = `synthetic-reference-${id}`;
			const referenceFixture = Bun.spawn(
				[
					process.execPath,
					"--no-env-file",
					agentFixture,
					"reference",
					id,
					`http://127.0.0.1:${speechServer.port}/generated-base.png`,
				],
				{ cwd: root, env: environment, stdout: "pipe", stderr: "pipe" },
			);
			assert.equal(
				await referenceFixture.exited,
				0,
				await new Response(referenceFixture.stderr).text(),
			);
			const attachedReference = await fetch(
				`${api}/api/operations/projects/${id}/reference-entities`,
				{
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify({ entity_id: referenceId }),
				},
			);
			assert.equal(attachedReference.status, 201, await attachedReference.text());
			const materials = projectMaterialsSchema.parse({
				story: { body: "Synthetic story notes" },
				visual: { body: "Keep generated plate", assetIds: [referenceId] },
				voice: { body: "Keep narration clear" },
				rules: {
					body: "Keep authored timing",
				},
				styleBible: { body: "Synthetic locked look", locked: true },
			});
			const chapters = [
				{ id: "proof-chapter", title: "Synthetic chapter", brief: "Keep generated scene" },
			];
			const bookmarks = [{ id: "proof-bookmark", timeSec: 2, label: "Synthetic bookmark" }];
			const projectReferences = {
				prompt: "Preserve synthetic character",
				entityIds: [referenceId],
			};
			const seeded = await fetch(`${api}/api/operations/projects/${id}/storyboards`, {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
				body: JSON.stringify({
					storyboard_json: {
						...(await detail()).storyboards[0].storyboard_json,
						materials,
						projectReferences,
						chapters,
						bookmarks,
					},
				}),
			});
			assert.equal(seeded.status, 201, await seeded.text());
			const preserved = async () => {
				const doc = (await detail()).storyboards[0].storyboard_json;
				assert.deepEqual(doc.materials, materials);
				assert.deepEqual(doc.projectReferences, projectReferences);
				assert.deepEqual(doc.chapters, chapters);
				assert.deepEqual(doc.bookmarks, bookmarks);
				assert.equal(
					doc.clips.find((clip: { id: string }) => clip.id === "scene:1").scene.src,
					`http://127.0.0.1:${speechServer.port}/generated-base.png`,
				);
				const roster = await (
					await fetch(`${api}/api/operations/projects/${id}/reference-entities`, {
						headers: { cookie },
					})
				).json();
				assert.ok(roster.items.some((entity: { id: string }) => entity.id === referenceId));
			};
			await preserved();
			const page = await context.newPage(),
				errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(`/content/${id}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const assets = page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true });
			await assets.click();
			const importButton = page.getByRole("button", { name: "Import files", exact: true });
			await expect(importButton).toBeEnabled();
			const chooser = page.waitForEvent("filechooser");
			if (width === 320) await importButton.tap();
			else {
				await importButton.focus();
				await page.keyboard.press("Enter");
			}
			await (
				await chooser
			).setFiles([
				{ name: "connected.png", mimeType: "image/png", buffer: image },
				{
					name: "connected.mp4",
					mimeType: "video/mp4",
					buffer: width === 320 ? mobileVideo : video,
				},
				{ name: "connected.m4a", mimeType: "audio/mp4", buffer: audio },
			]);
			for (const name of ["connected.png", "connected.mp4", "connected.m4a"])
				await expect(
					page.getByRole("button", { name: `Add ${name} to timeline`, exact: true }),
				).toBeVisible({ timeout: 60000 });
			// Usable at once while they upload; this flow edits processed sources, so it waits for all three.
			await expect(page.locator("[data-upload-state]")).toHaveCount(0, { timeout: 60000 });
			await expect
				.poll(
					async () =>
						(await detail()).project.editor_state_json?.media_assets?.filter(
							(asset: { metadata?: { originalFilename?: string } }) =>
								asset.metadata?.originalFilename?.startsWith("connected."),
						).length ?? 0,
				)
				.toBe(3);
			assert.equal(
				(await detail()).storyboards[0].storyboard_json.clips.length,
				1,
				"Staging must not create clips",
			);
			await page
				.getByRole("searchbox", { name: "Search media", exact: true })
				.fill("connected.mp4");
			await expect(
				page.getByRole("button", { name: "Add connected.mp4 to timeline", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Add connected.png to timeline", exact: true }),
			).toHaveCount(0);
			await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("");
			await chooseOption(page.getByRole("combobox", { name: "Sort media", exact: true }), "name");
			for (const name of ["connected.png", "connected.mp4", "connected.m4a"])
				await page.getByRole("button", { name: `Add ${name} to timeline`, exact: true }).click();
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await expect
				.poll(async () => (await detail()).storyboards[0].storyboard_json.clips.length, {
					timeout: 10000,
				})
				.toBe(4);
			await preserved();
			const saved = (await detail()).storyboards[0].storyboard_json;
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await expect(page.locator('[data-clipid^="scene:"]')).toHaveCount(2);
			await expect(page.locator('[data-clipid^="video:"]')).toHaveCount(1);
			await expect(page.locator('[data-clipid^="audio:"]')).toHaveCount(1);
			assert.deepEqual((await detail()).storyboards[0].storyboard_json, saved);
			const videoId: string = saved.clips.find(
				(clip: { type: string }) => clip.type === "video",
			).id;
			const currentVideo = async () =>
				(await detail()).storyboards[0].storyboard_json.clips.find(
					(clip: { id: string }) => clip.id === videoId,
				).video;
			type Group = "Timing" | "Transform" | "Masks" | "Blending" | "Adjust";
			const open = async (group: Group) => {
				await page.locator(`[data-clipid="${videoId}"]`).click();
				if (width === 320) await page.locator(`.tl2-clipbar-groups [aria-label="${group}"]`).tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: group, exact: true })
						.click();
			};
			const close = async () => {
				if (width === 320) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
			};
			const fill = async (name: string, value: string) => {
				const field = page.getByRole("spinbutton", { name, exact: true });
				await field.fill(value);
				await field.press("Tab");
			};
			await open("Timing");
			await page.getByRole("button", { name: "In forward one frame", exact: true }).click();
			await expect.poll(async () => (await currentVideo()).mediaStartSec).toBeCloseTo(1 / 30, 6);
			const playback = page.getByRole("button", { name: /^Playback/ });
			if ((await playback.getAttribute("aria-expanded")) !== "true") await playback.click();
			await page.getByRole("button", { name: "Reverse", exact: true }).click();
			await expect
				.poll(async () => (await currentVideo()).layout?.reverseMedia?.url, { timeout: 60000 })
				.toBeTruthy();
			await page.getByRole("button", { name: "Extract audio", exact: true }).click();
			await expect
				.poll(async () => (await currentVideo()).layout?.sourceAudioExtraction?.audioClipId, {
					timeout: 60000,
				})
				.toBeTruthy();
			await fill("Rate (%)", "50");
			await expect
				.poll(async () => (await currentVideo()).layout?.playbackRate, { timeout: 60000 })
				.toBe(0.5);
			await close();
			await open("Transform");
			await page.locator(".ui-insp-toggle").filter({ hasText: "Crop" }).click();
			await fill("Crop width", "75");
			await expect.poll(async () => (await currentVideo()).layout?.crop?.widthPct).toBe(75);
			await page.getByRole("button", { name: "Position keyframe", exact: true }).click();
			await fill("X offset", "5");
			await expect
				.poll(async () => (await currentVideo()).layout?.animation?.tracks.xPct?.[0]?.v)
				.toBe(5);
			await close();
			await open("Masks");
			await chooseOption(
				page.getByRole("combobox", { name: "Mask shape", exact: true }),
				"ellipse",
			);
			await close();
			await open("Blending");
			await chooseOption(page.getByRole("combobox", { name: "Blend mode", exact: true }), "screen");
			await close();
			await open("Adjust");
			await fill("brightness", "80");
			await expect.poll(async () => (await currentVideo()).layout?.color?.brightness).toBe(0.8);
			await close();
			await page.locator('button[aria-label="Undo"][title]').click();
			await expect.poll(async () => (await currentVideo()).layout?.color?.brightness ?? 1).toBe(1);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(async () => (await currentVideo()).layout?.color?.brightness).toBe(0.8);
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await open("Masks");
			await expect(page.getByRole("combobox", { name: "Mask shape", exact: true })).toHaveAttribute(
				"data-value",
				"ellipse",
			);
			await close();
			await open("Blending");
			await expect(page.getByRole("combobox", { name: "Blend mode", exact: true })).toHaveAttribute(
				"data-value",
				"screen",
			);
			await close();
			await open("Adjust");
			await expect(page.getByRole("spinbutton", { name: "brightness", exact: true })).toHaveValue(
				"80",
			);
			await close();
			assert.equal(
				(await detail()).storyboards[0].storyboard_json.clips.find(
					(clip: { id: string }) => clip.id === "scene:1",
				).scene.vo,
				"Original narration",
			);
			const authoredLayout = (await currentVideo()).layout;
			const agentState = join(directory, `agent-${width}.json`);
			const agent = async (action: "seed" | "finish" | "remove", input = agentState) => {
				const fixture = Bun.spawn(
					[process.execPath, "--no-env-file", agentFixture, action, id, input],
					{ cwd: root, env: environment, stdout: "pipe", stderr: "pipe" },
				);
				assert.equal(await fixture.exited, 0, await new Response(fixture.stderr).text());
			};
			await preserved();
			await agent("seed");
			const attached = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === `/api/operations/projects/${id}/chat` &&
					response.request().method() === "GET",
			);
			await page.reload();
			assert.equal((await (await attached).json()).status, "running");
			await agent("finish");
			const narrationText = async () =>
				(await detail()).storyboards[0].storyboard_json.clips.find(
					(clip: { id: string }) => clip.id === "scene:1",
				).scene.vo;
			await expect.poll(narrationText, { timeout: 15000 }).toBe("Edited narration");
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			assert.deepEqual((await currentVideo()).layout, authoredLayout);
			await page.locator('button[aria-label="Undo"][title]').click();
			await expect.poll(narrationText).toBe("Original narration");
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(narrationText).toBe("Edited narration");
			assert.deepEqual((await currentVideo()).layout, authoredLayout);
			await page.getByRole("button", { name: "Export Video", exact: true }).click();
			const submitted = page.waitForResponse(
				(response) =>
					response.url().includes("/api/video/render") && response.request().method() === "POST",
			);
			await page.getByRole("menuitem", { name: /Server render/ }).click();
			const response = await submitted;
			assert.equal(response.status(), 202, await response.text());
			const jobId: string = (await response.json()).id;
			const rendered = async () =>
				(await fetch(`${api}/api/video/render/${jobId}`, { headers: { cookie } })).json();
			await expect
				.poll(async () => (await rendered()).status, { timeout: 180000 })
				.toMatch(/^(done|done_with_fallback|failed|error)$/);
			const completed = await rendered();
			assert.equal(completed.status, "done", JSON.stringify(completed));
			const output = await fetch(new URL((await rendered()).output_url, api), {
				headers: { cookie },
			});
			assert.equal(output.status, 200);
			const exported = join(directory, `export-${width}.mp4`);
			await Bun.write(exported, await output.arrayBuffer());
			const pixel = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-ss",
				"1",
				"-i",
				exported,
				"-vf",
				"format=rgb24,crop=1:1:iw*0.6:ih*0.35",
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				"pipe:1",
			]);
			assert.ok(
				pixel[0]! < 15 && pixel[1]! < 15 && pixel[2]! > 180,
				`Composited blue pixel: ${[...pixel]}`,
			);
			const samples = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-ss",
				"1",
				"-i",
				exported,
				"-t",
				"1",
				"-vn",
				"-ac",
				"1",
				"-ar",
				"48000",
				"-f",
				"f32le",
				"pipe:1",
			]);
			let real = 0,
				imaginary = 0;
			for (let sample = 0; sample < samples.length / 4; sample++) {
				const value = samples.readFloatLE(sample * 4),
					angle = (2 * Math.PI * 440 * sample) / 48000;
				real += value * Math.cos(angle);
				imaginary += value * Math.sin(angle);
			}
			assert.ok(
				(2 * Math.hypot(real, imaginary)) / (samples.length / 4) > 0.02,
				"Imported audio remains audible in production export",
			);
			await preserved();
			const oldSource = await currentVideo();
			await agent("remove", oldSource.url.split("/").at(-1));
			assert.equal((await fetch(new URL(oldSource.url, api), { headers: { cookie } })).status, 404);
			assert.equal(
				(
					await fetch(
						`${api}/internal/media/${oldSource.url.split("/").at(-1)}?workspace=default`,
						{ headers: { authorization: `Bearer ${serviceToken}` } },
					)
				).status,
				404,
			);
			await (
				await context.newCDPSession(page)
			).send("Network.setCacheDisabled", { cacheDisabled: true });
			await assets.click();
			await page.getByRole("button", { name: "Media details: connected.mp4", exact: true }).click();
			const missing = page.getByRole("dialog", {
				name: "Media details: connected.mp4",
				exact: true,
			});
			await expect(missing.getByRole("alert")).toContainText("Could not read source");
			const relink = page.waitForEvent("filechooser");
			await missing.getByRole("button", { name: "Replace source", exact: true }).click();
			const replacement = bytes([
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=64x36:r=30:d=9",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=880:sample_rate=48000:duration=9",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]);
			await (
				await relink
			).setFiles({ name: "relinked.mp4", mimeType: "video/mp4", buffer: replacement });
			await expect
				.poll(async () => (await currentVideo()).url, { timeout: 60000 })
				.not.toBe(oldSource.url);
			assert.equal((await currentVideo()).mediaAssetId, oldSource.mediaAssetId);
			const withoutDerivatives = (layout: ClipLayout) => {
				const authored = { ...layout };
				delete authored.reverseMedia;
				delete authored.audioMedia;
				delete authored.sourceAudioExtraction;
				return authored;
			};
			assert.deepEqual(
				withoutDerivatives((await currentVideo()).layout),
				withoutDerivatives(oldSource.layout),
			);
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await page.getByRole("button", { name: "Media details: connected.mp4", exact: true }).click();
			await expect
				.poll(() =>
					missing.locator("video").evaluate((element: HTMLVideoElement) => element.readyState),
				)
				.toBeGreaterThanOrEqual(2);
			await preserved();
			await pendingMediaFlow({
				page,
				width,
				api,
				cookie,
				plate: `http://127.0.0.1:${speechServer.port}/generated-base.png`,
				rendered: async (job: string) =>
					(await fetch(`${api}/api/video/render/${job}`, { headers: { cookie } })).json(),
			});
			await page.goto(`/content/${id}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			if (width === 320) {
				const beforeRestart = (await detail()).storyboards[0].storyboard_json;
				for (const name of ["worker", "api", "video"]) {
					const index = children.findIndex((child) => child.name === name);
					const [child] = children.splice(index, 1);
					child!.process.kill();
					await child!.process.exited;
				}
				start("api", join(root, "apps/api"), [process.execPath, "--no-env-file", "src/index.ts"]);
				start(
					"worker",
					join(root, "apps/media-worker"),
					[process.execPath, "--no-env-file", "src/index.ts"],
					{ INNGEST_APP_ID: "maleo-media" },
				);
				start(
					"video",
					renderDirectory,
					[process.execPath, "--no-env-file", join(root, "apps/render-worker/src/index.ts")],
					{
						MALEO_TTS_PROVIDER: "kokoro",
						MALEO_KOKORO_URL: `http://127.0.0.1:${speechServer.port}`,
					},
				);
				await Promise.all([
					ready(`${api}/api/auth-state`),
					ready(`${worker}/health`),
					ready(`${environment.MALEO_VIDEO_URL}/health`),
				]);
				assert.equal((await (await fetch(`${worker}/health`)).json()).processing.available, true);
				assert.deepEqual((await detail()).storyboards[0].storyboard_json, beforeRestart);
				assert.equal((await rendered()).status, "done");
				assert.equal(
					(await fetch(new URL((await currentVideo()).url, api), { headers: { cookie } })).status,
					200,
				);
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await expect(page.locator(`[data-clipid="${videoId}"]`)).toBeVisible();
				await preserved();
			}
			assert.deepEqual(errors, []);
			console.log(
				JSON.stringify({
					width,
					productionBundle: true,
					cookieAuth: true,
					actualWorkerImports: 3,
					stagedWithoutClips: true,
					placed: 3,
					trimCropReverseExtractRetimeKeysCompositing: true,
					syntheticAgentNarrationMerge: true,
					undoRedo: true,
					pendingPlaceEditReloadResumeReadyUndoExport: true,
					pendingInterruptedChooseAgain: true,
					persistedReload: true,
					productionExportPixelsAudio: true,
					missingSourceRelink: true,
					generatedReferenceMaterialsPreserved: true,
					serviceRestart: width === 320,
				}),
			);
		} finally {
			await context.close();
		}
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
	void speech?.stop(true);
	await postgres.stop();
	await rm(directory, { recursive: true, force: true });
}
