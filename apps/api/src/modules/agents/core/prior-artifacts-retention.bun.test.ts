/* The one reader that walks storyboard history is the agent's artifact seed: an
 * editor autosave carries no artifacts, so the live plan often sits several
 * versions behind the head. Retention must leave that reader's answer unchanged
 * however far the autosaves run past the window. */
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { STORYBOARD_RETENTION_WINDOW_ENV } from "@maleo/db/storyboard-retention";
import { loadPriorArtifacts } from "./persistence.ts";

const dbPath = join(tmpdir(), "maleo-prior-artifacts-retention.test.db");
const prior = {
	db: process.env.MALEO_DB_PATH,
	window: process.env[STORYBOARD_RETENTION_WINDOW_ENV],
};

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}
function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	process.env[STORYBOARD_RETENTION_WINDOW_ENV] = "3";
	await resetDb();
});
afterEach(async () => {
	await resetDb();
	restore("MALEO_DB_PATH", prior.db);
	restore(STORYBOARD_RETENTION_WINDOW_ENV, prior.window);
});

test("the seeded artifacts survive autosaves far beyond the retention window", async () => {
	const projectId = (await createContentProject({ title: "Seed", type: "video" }))!.project.id;
	const [plan] = fixtureArtifacts(projectId, [
		{
			kind: "story_plan",
			payload: {
				targetSec: 60,
				sections: [
					{ id: "s1", title: "Open", narration: "n", visualPrompt: "v", estimatedDurationSec: 60 },
				],
			},
		},
	]);
	const [media] = fixtureArtifacts(projectId, [
		{ kind: "media", payload: { mediaType: "image", url: "/uploads/a.png" } },
	]);
	await addContentStoryboard({
		project_id: projectId,
		storyboard_json: { schemaVersion: 2, clips: [], markers: [], artifacts: [media] },
	});
	await addContentStoryboard({
		project_id: projectId,
		storyboard_json: { schemaVersion: 2, clips: [], markers: [], artifacts: [plan] },
	});
	const before = await loadPriorArtifacts(projectId);
	for (let i = 0; i < 40; i++) {
		await addContentStoryboard({
			project_id: projectId,
			storyboard_json: { schemaVersion: 2, clips: [], markers: [] },
		});
	}
	const after = await loadPriorArtifacts(projectId);
	expect(after).toEqual(before);
	expect(after.map((a) => a.kind).sort()).toEqual(["media", "story_plan"]);
});
