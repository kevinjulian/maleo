import { expect, test } from "bun:test";
import { openTestDb } from "@maleo/db/handle-testing";
import { resolveLegacyStoryboardMedia } from "./legacy-storyboard-media.ts";

test("historical storyboard media resolves by owner without changing snapshot", async () => {
	const t = await openTestDb("postgres", { migrated: false });
	const db = t.db;
	await db.exec(
		"CREATE TABLE legacy_media_links (legacy_path text, workspace text, media_id text, PRIMARY KEY (legacy_path, workspace))",
	);
	await db.run("INSERT INTO legacy_media_links VALUES ('/files/voice.wav', 'team', 'owned')");
	await db.run("INSERT INTO legacy_media_links VALUES ('/files/voice.wav', 'other', 'foreign')");
	const prior = process.env.MALEO_GEN_WORKER_URL;
	process.env.MALEO_GEN_WORKER_URL = "http://worker.test:7071";
	try {
		const snapshot = {
			clips: [
				{ url: "/files/voice.wav" },
				{ url: "http://worker.test:7071/files/voice.wav" },
				{ url: "https://foreign.test/files/voice.wav" },
				{ url: "http://local.invalid/files/voice.wav" },
				{ url: "/files/missing.wav" },
				{ url: "http://worker.test:7071/files/missing.wav" },
			],
		};
		const resolved = await resolveLegacyStoryboardMedia(snapshot, "team", db);
		expect(resolved).toEqual({
			clips: [
				{ url: "/api/media/owned" },
				{ url: "/api/media/owned" },
				{ url: "https://foreign.test/files/voice.wav" },
				{ url: "http://local.invalid/files/voice.wav" },
				{ url: "/files/missing.wav" },
				{ url: "http://worker.test:7071/files/missing.wav" },
			],
		});
		expect(snapshot.clips[0]!.url).toBe("/files/voice.wav");
	} finally {
		if (prior === undefined) delete process.env.MALEO_GEN_WORKER_URL;
		else process.env.MALEO_GEN_WORKER_URL = prior;
		await t.close();
	}
});
