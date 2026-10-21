import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaClient } from "@maleo/media/api";
import { putMedia } from "@maleo/storage";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { getMediaObject } from "@maleo/db/media-objects";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { setMediaClientForTests } from "../image-gen-client.ts";
import { pollImageJob, submitImageJob } from "./image-generator.ts";

const oldDb = process.env.MALEO_DB_PATH;
const oldData = process.env.MALEO_DATA_DIR;
const oldBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
let root: string | undefined;

afterEach(async () => {
	setMediaClientForTests(undefined);
	await closeMaleoDb();
	if (oldDb === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = oldDb;
	process.env.MALEO_DATA_DIR = oldData ?? join(tmpdir(), "maleo-test-data-fallback");
	if (oldBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = oldBackend;
	if (root) await rm(root, { recursive: true, force: true });
});

test("worker object becomes stable URL under durable image-job owner", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-image-job-storage-"));
	process.env.MALEO_DB_PATH = join(root, "db.sqlite");
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	const db = openDb();
	await db.run(
		`INSERT INTO workspaces (name, display_name, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`,
		["project-owner", "project-owner", root],
	);
	const project = await createContentProject(
		{ title: "Generated image", workspace: "project-owner" },
		db,
	);
	const stored = await putMedia({
		workspace: "project-owner",
		kind: "image",
		body: new Blob(["image"]),
		contentType: "image/png",
	});
	let submittedWorkspace: string | undefined;
	const client: MediaClient = {
		async submitImage(request) {
			submittedWorkspace = request.workspaceId;
			return "job-managed";
		},
		async submitVideo() {
			throw new Error("unused");
		},
		async videoReadiness() {
			return {};
		},
		async submitTts() {
			throw new Error("unused");
		},
		async poll() {
			return {
				id: "job-managed",
				kind: "image",
				status: "done",
				imageUrl: null,
				audioUrl: null,
				stored: {
					key: stored.key,
					hash: stored.hash,
					size: stored.size,
					contentType: stored.contentType,
				},
				fromCache: false,
				providerId: "test",
				providerSource: "default",
				model: null,
				cost: null,
				latencyMs: null,
				error: null,
			};
		},
		async download() {
			throw new Error("unused");
		},
		fileUrl(path) {
			return path;
		},
	};
	setMediaClientForTests(client);
	await submitImageJob(
		{ prompt: "scene" },
		{ workspace: "project-owner", projectId: project.project.id, source: "clip" },
	);
	const result = await pollImageJob("job-managed");
	expect(submittedWorkspace).toBe("project-owner");
	expect(result.imageUrl).toMatch(/^\/api\/media\//);
	expect(result.imageUrlPublic).toBe(result.imageUrl);
	expect((await getMediaObject(result.imageUrl!.split("/").at(-1)!))?.workspace).toBe(
		"project-owner",
	);
	await addContentStoryboard(
		{
			project_id: project.project.id,
			storyboard_json: { timeline: { clips: [{ src: result.imageUrl }] } },
		},
		db,
	);
	// Read back through the runtime: the rows are in the database, not a cache.
	const reloaded = await getContentProject(project.project.id, openDb());
	expect(reloaded?.storyboards[0]?.storyboard_json).toEqual({
		timeline: { clips: [{ src: result.imageUrl }] },
	});
	expect(JSON.stringify(reloaded)).not.toContain("signature=");
});
