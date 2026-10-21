/* Who draws from a preset, and who has drifted off it. Points MALEO_DB_PATH at a
 * throwaway file so the shared maleo.db is never touched.
 *
 * This is the same stored fact the editor reads per project, read from the opposite
 * direction — so the assertions are mostly about the two agreeing on what "uses" and
 * "diverged" mean. Getting that wrong in one direction only is how a library view ends up
 * confidently reporting a number the editor contradicts.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContentPreset, getContentPresetUsage } from "./content-presets.ts";
import { createContentProject, setContentEditorState } from "./project-detail.ts";
import { closeMaleoDb, openDb } from "./connection.ts";
import { presetBundle } from "@maleo/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "preset-usage-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

const PRESET = "cp_target";
const OTHER = "cp_other";

async function project(title: string, state: Record<string, unknown>): Promise<string> {
	const created = await createContentProject({ title, type: "video" });
	if (!created) throw new Error("project not created");
	await setContentEditorState(created.project.id, state);
	return created.project.id;
}

beforeEach(async () => {
	await openDb().run("DELETE FROM content_projects");
});

afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("a project counts as using a preset", () => {
	test("when the preset is its active one", async () => {
		await project("active", { active_preset_id: PRESET });
		expect((await getContentPresetUsage(PRESET)).using).toBe(1);
	});

	test("when any element records the preset as its supplier", async () => {
		await project("supplied", {
			element_sources: { style: { layer: "project-preset", defaulterId: PRESET } },
		});
		expect((await getContentPresetUsage(PRESET)).using).toBe(1);
	});

	test("not when it only mentions a different preset", async () => {
		await project("elsewhere", {
			active_preset_id: OTHER,
			element_sources: { style: { layer: "project-preset", defaulterId: OTHER } },
		});
		expect((await getContentPresetUsage(PRESET)).using).toBe(0);
	});

	test("not when it has no editor state at all", async () => {
		const created = await createContentProject({ title: "bare", type: "video" });
		expect(created).toBeTruthy();
		expect((await getContentPresetUsage(PRESET)).using).toBe(0);
	});

	/* The scan prefilters with a substring match on the id, which can admit a project that
	 * merely mentions the id somewhere unrelated. Every candidate is parsed and verified,
	 * so a coincidental mention must not be counted. */
	test("not when the id appears somewhere that is not a source", async () => {
		await project("coincidence", { direction: { raw: `notes about ${PRESET}` } });
		expect((await getContentPresetUsage(PRESET)).using).toBe(0);
	});
});

describe("a using project counts as diverged", () => {
	test("when it owns at least one element", async () => {
		await project("drifted", {
			active_preset_id: PRESET,
			element_sources: {
				style: { layer: "project-preset", defaulterId: PRESET },
				"settings.voice": { layer: "operator", defaulterId: null },
			},
		});
		const usage = await getContentPresetUsage(PRESET);
		expect(usage.using).toBe(1);
		expect(usage.diverged).toBe(1);
		expect(usage.projects[0]?.diverged).toEqual(["settings.voice"]);
	});

	test("not when every element still comes from the preset", async () => {
		await project("faithful", {
			active_preset_id: PRESET,
			element_sources: { style: { layer: "project-preset", defaulterId: PRESET } },
		});
		const usage = await getContentPresetUsage(PRESET);
		expect(usage.using).toBe(1);
		expect(usage.diverged).toBe(0);
		expect(usage.projects).toEqual([]);
	});

	test("the diverged paths are named, so the view can say what drifted", async () => {
		await project("named", {
			active_preset_id: PRESET,
			element_sources: {
				"settings.voice": { layer: "operator", defaulterId: null },
				pacingDevices: { layer: "operator", defaulterId: null },
			},
		});
		expect((await getContentPresetUsage(PRESET)).projects[0]?.diverged).toEqual([
			"pacingDevices",
			"settings.voice",
		]);
	});

	test("the diverged list carries the preset value and the project value", async () => {
		const preset = await createContentPreset({
			name: "Target",
			description: "",
			bundle: presetBundle({ settings: { voice: "Preset voice" } }),
		});
		await project("valued", {
			active_preset_id: preset.id,
			settings: { voice: "Mine" },
			element_sources: { "settings.voice": { layer: "operator", defaulterId: null } },
		});
		expect((await getContentPresetUsage(preset.id)).projects[0]?.divergedDetails).toEqual([
			{ path: "settings.voice", projectValue: "Mine", defaulterValue: "Preset voice" },
		]);
	});

	test("counts accumulate across projects", async () => {
		await project("a", { active_preset_id: PRESET });
		await project("b", {
			active_preset_id: PRESET,
			element_sources: { style: { layer: "operator", defaulterId: null } },
		});
		await project("c", {
			active_preset_id: PRESET,
			element_sources: { style: { layer: "operator", defaulterId: null } },
		});
		const usage = await getContentPresetUsage(PRESET);
		expect(usage.using).toBe(3);
		expect(usage.diverged).toBe(2);
	});
});

describe("the scan refuses to inflate what it reports", () => {
	/* An unreadable blob cannot be claimed as usage. Counting it would pad a number an
	 * operator makes a decision from — "12 projects affected" has to mean twelve. */
	test("an unparseable editor state is skipped, not counted", async () => {
		const id = await project("broken", { active_preset_id: PRESET });
		await openDb().run("UPDATE content_projects SET editor_state_json = ? WHERE id = ?", [
			`{"active_preset_id":"${PRESET}"`,
			id,
		]);
		expect((await getContentPresetUsage(PRESET)).using).toBe(0);
	});

	test("an empty preset id matches nothing rather than everything", async () => {
		await project("active", { active_preset_id: PRESET });
		expect(await getContentPresetUsage("")).toEqual({ using: 0, diverged: 0, projects: [] });
		expect(await getContentPresetUsage("   ")).toEqual({ using: 0, diverged: 0, projects: [] });
	});

	test("the project list is capped while the count stays true", async () => {
		for (let i = 0; i < 55; i += 1) {
			await project(`p${i}`, {
				active_preset_id: PRESET,
				element_sources: { style: { layer: "operator", defaulterId: null } },
			});
		}
		const usage = await getContentPresetUsage(PRESET);
		expect(usage.diverged).toBe(55);
		expect(usage.projects).toHaveLength(50);
	});
});
