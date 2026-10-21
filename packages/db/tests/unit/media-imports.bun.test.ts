import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { openTestDb } from "../../src/db/handle-testing.ts";
import { createContentProject } from "../../src/db/project-detail.ts";
import {
	attachImportOriginal,
	cancelProjectMediaImport,
	failProjectMediaImport,
	getProjectMediaImport,
	reserveProjectMediaImport,
	listPendingProjectImports,
} from "../../src/db/media-imports.ts";

test("project import reservation serializes retries, scopes source ownership and rejects stale/cancelled completion", async () => {
	const t = await openTestDb("postgres");
	try {
		const project = (await createContentProject({ title: "Import", workspace: "proof" }, t.db))!;
		const input = {
			workspace: "proof",
			projectId: project.project.id,
			requestKey: "retry",
			filename: "camera.mov",
			kind: "video" as const,
			uploadTimeoutMs: 60000,
		};
		const reservations = await Promise.all([
			reserveProjectMediaImport(input, t.db),
			reserveProjectMediaImport(input, t.db),
		]);
		expect(reservations.map((r) => r.row.id)).toEqual([
			reservations[0]!.row.id,
			reservations[0]!.row.id,
		]);
		expect(reservations.filter((r) => r.claimed)).toHaveLength(1);
		const row = reservations[0]!.row;
		await expect(reserveProjectMediaImport({ ...input, workspace: "other" }, t.db)).rejects.toThrow(
			"does not belong",
		);
		await expect(
			reserveProjectMediaImport({ ...input, filename: "another.mov" }, t.db),
		).rejects.toThrow("does not match");
		const original = {
			key: `workspaces/proof/file/${input.projectId}/${randomUUID()}-camera.mov`,
			hash: "a".repeat(64),
			size: 100,
			contentType: "application/octet-stream",
		};
		await expect(
			attachImportOriginal(
				row,
				{ ...original, key: original.key.replace("proof/", "other/") },
				t.db,
			),
		).rejects.toThrow("ownership");
		expect(await attachImportOriginal(row, original, t.db)).toBe(true);
		await failProjectMediaImport(row, "interrupted", t.db);
		const retry = await reserveProjectMediaImport(input, t.db);
		expect(retry.row.id).toBe(row.id);
		expect(retry.row.source_revision).not.toBe(row.source_revision);
		expect(await attachImportOriginal(row, original, t.db)).toBe(false);
		expect(await cancelProjectMediaImport(retry.row, t.db)).toBe(true);
		expect(await attachImportOriginal(retry.row, original, t.db)).toBe(false);
		expect((await getProjectMediaImport(row.id, t.db))?.status).toBe("cancelled");
		await t.db.run("DELETE FROM content_projects WHERE id = ?", [input.projectId]);
		expect(await getProjectMediaImport(row.id, t.db)).toBeNull();
	} finally {
		await t.close();
	}
});

test("pending import reload uses bounded stable cursor pages and excludes cancelled/other scope", async () => {
	const t = await openTestDb("postgres");
	try {
		const project = (await createContentProject({ title: "Cursor", workspace: "proof" }, t.db))!;
		for (let i = 0; i < 53; i++)
			await reserveProjectMediaImport(
				{
					workspace: "proof",
					projectId: project.project.id,
					requestKey: `file-${i}`,
					filename: `${i}.png`,
					kind: "image",
					uploadTimeoutMs: 60000,
				},
				t.db,
			);
		const first = await listPendingProjectImports("proof", project.project.id, null, t.db);
		expect(first).toHaveLength(51);
		const tail = await listPendingProjectImports("proof", project.project.id, first[49]!.id, t.db);
		expect(tail).toHaveLength(3);
		expect(new Set([...first.slice(0, 50), ...tail].map((row) => row.id)).size).toBe(53);
		expect(await listPendingProjectImports("other", project.project.id, null, t.db)).toEqual([]);
		await cancelProjectMediaImport(first[0]!, t.db);
		expect(
			(await listPendingProjectImports("proof", project.project.id, null, t.db)).some(
				(row) => row.id === first[0]!.id,
			),
		).toBe(false);
	} finally {
		await t.close();
	}
});
