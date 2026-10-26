import { cleanRetiredProjectVisuals, cleanRetiredVisualTemplate } from "@maleo/shared";
import { serialize, type Db } from "./handle.ts";
import { openDb } from "./connection.ts";
import { addContentStoryboard, type StoredStoryboardRow } from "./storyboards.ts";
import { headCommandSeq } from "./project-commands.ts";
import { getGlobalSetting, setGlobalSetting } from "./global-settings.ts";
import { VISUAL_CONTRACT_SETTING } from "./visual-contract.ts";

/** Library rows are cleaned together; IDs, owners and timestamps survive updates. */
export async function cleanContentVisualTemplates(apply: boolean, db: Db = openDb()) {
	return db.transaction(async (tx) => {
		await serialize(tx, "visual-templates");
		const report = { changedTemplates: 0, removedTemplates: 0, removedLayers: 0 };
		const rows = await tx.all<{
			id: string;
			kind: string;
			base: string;
			category: string;
			config_json: string;
		}>("SELECT id, kind, base, category, config_json FROM content_clip_templates ORDER BY id");
		for (const row of rows) {
			const cleaned = cleanRetiredVisualTemplate({ ...row, config: JSON.parse(row.config_json) });
			report.removedLayers += cleaned.counts.removedLayers;
			report.removedTemplates += cleaned.counts.removedTemplates;
			if (!cleaned.changed) continue;
			report.changedTemplates++;
			if (!apply) continue;
			if (!cleaned.value) await tx.run("DELETE FROM content_clip_templates WHERE id = ?", [row.id]);
			else {
				const category = cleaned.value.category;
				if (typeof category !== "string") throw new Error("Cleaned template category is missing");
				await tx.run(
					"UPDATE content_clip_templates SET config_json = ?, category = ? WHERE id = ?",
					[JSON.stringify(cleaned.value.config), category, row.id],
				);
			}
		}
		return report;
	});
}

/** Aggregate counts only. Interrupted applies resume from the remaining heads. */
export async function cleanContentVisuals(apply: boolean, db: Db = openDb()) {
	const templates = await cleanContentVisualTemplates(apply, db);
	const report = { ...templates, changedProjects: 0, removedClips: 0 };
	for (const project of await db.all<{ id: string }>(
		"SELECT id FROM content_projects ORDER BY id",
	)) {
		const cleaned = await cleanContentProjectVisuals(project.id, apply, db);
		if (cleaned.changed) report.changedProjects++;
		report.removedClips += cleaned.counts.removedClips;
		report.removedLayers += cleaned.counts.removedLayers;
	}
	if (apply && (await getGlobalSetting(VISUAL_CONTRACT_SETTING, db)) !== "1")
		await setGlobalSetting(VISUAL_CONTRACT_SETTING, "1", db);
	return report;
}

/** Read, clean and persist under the same lock used by ordinary project writers. */
export async function cleanContentProjectVisuals(
	projectId: string,
	apply: boolean,
	db: Db = openDb(),
) {
	return db.transaction(async (tx) => {
		await serialize(tx, `storyboard-version:${projectId}`);
		const head = await tx.get<StoredStoryboardRow>(
			"SELECT * FROM content_storyboards WHERE project_id = ? ORDER BY version DESC LIMIT 1",
			[projectId],
		);
		if (!head)
			return { changed: false, counts: { removedClips: 0, removedLayers: 0, removedTemplates: 0 } };
		const result = cleanRetiredProjectVisuals(JSON.parse(head.storyboard_json));
		if (apply && result.changed) {
			const saved = await addContentStoryboard(
				{
					project_id: projectId,
					expectedRevisionId: head.id,
					source_prompt: head.source_prompt,
					reference_notes: head.reference_notes,
					storyboard_json: result.value,
					actor_type: "visual-cleanup",
				},
				tx,
			);
			if (!saved) throw new Error("Project vanished during visual cleanup");
			await tx.run("UPDATE content_projects SET visual_cleanup_seq = ? WHERE id = ?", [
				await headCommandSeq(tx, projectId),
				projectId,
			]);
		}
		return { changed: result.changed, counts: result.counts };
	});
}
