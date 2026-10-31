import { afterEach, describe, expect, test } from "bun:test";
import { MOTION_EXAMPLES } from "@maleo/shared";
import { setTextRunnerForTests } from "../../../../../lib/text-runner.ts";
import { buildToolContext } from "../../tool-executor.ts";
import { runDocument } from "../../edit-document.ts";
import { overlayTools } from "./index.ts";
import { addMotionDesign } from "./add-motion-design.ts";
import { addMotionDesignArgs } from "../../helpers/schemas.ts";
import type { AgentJob } from "../../model.ts";

const headline = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;

const job = (): AgentJob => ({
	id: "job",
	projectId: "p",
	contentType: "video",
	status: "running",
	events: [],
	scenes: [
		{
			id: 5,
			startSec: 0,
			name: "Open",
			durationSec: 10,
			shot: "wide",
			move: "static",
			transition: "fade",
			visual: "a",
			voiceover: "one",
			image: "a.png",
			layout: { xPct: 0, widthPct: 100 },
		},
	],
	textOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	aspect: "16:9",
	brief: "b",
	startedAt: 0,
});

const run = (j: AgentJob, args: unknown) =>
	addMotionDesign.handler!(buildToolContext(j), addMotionDesignArgs.parse(args));

const answering = (...replies: string[]) =>
	setTextRunnerForTests(async () => ({ stdout: replies.shift() ?? "{}", stderr: "" }));

afterEach(() => setTextRunnerForTests(null));

describe("add_motion_design", () => {
	test("is offered with the other overlay tools", () => {
		expect(overlayTools.map((tool) => tool.name)).toContain("add_motion_design");
	});

	test("places one clip per layer, on its own lane, as one editor command", async () => {
		const j = job();
		answering(JSON.stringify(headline.intent));
		const result = await run(j, {
			description: "bold title card with an accent bar",
			startSec: 4,
			durationSec: 3,
			text: "Ship faster",
		});
		expect(result.note).toContain("Added motion design (3 clips) at 4s for 3s.");
		expect(j.editCommands).toHaveLength(1);
		const command = j.editCommands![0]!;
		expect(command.type).toBe("batch");
		expect(command.type === "batch" && command.commands.map((c) => c.type)).toEqual([
			"clip.insert",
			"clip.insert",
			"clip.insert",
		]);
		const clips = runDocument(j).clips.filter((c) => c.text);
		expect(clips).toHaveLength(3);
		expect(new Set(clips.map((c) => c.track)).size).toBe(3);
		const title = clips.find((c) => c.text?.preset === "plain")!;
		expect(title.text!.content).toBe("Ship faster");
		expect(title.startSec).toBeGreaterThanOrEqual(4);
		expect(title.startSec + title.durationSec).toBeLessThanOrEqual(7 + 1e-9);
		expect(title.text!.layout?.animation?.tracks.yPct?.length).toBeGreaterThan(1);
	});

	test("a refused intent is an error and leaves the document unchanged", async () => {
		const j = job();
		const before = JSON.stringify(runDocument(j));
		answering("not json", "{}");
		await expect(
			run(j, { description: "title", startSec: 0, durationSec: 2, text: "Ship faster" }),
		).rejects.toThrow(/add_motion_design refused: layers/);
		expect(j.editCommands ?? []).toEqual([]);
		expect(JSON.stringify(runDocument(j))).toBe(before);
	});

	test("text it was not given cannot appear", async () => {
		const j = job();
		answering(JSON.stringify(headline.intent), JSON.stringify(headline.intent));
		await expect(
			run(j, { description: "a moving accent shape", startSec: 0, durationSec: 2 }),
		).rejects.toThrow(/must be quoted from the source text/);
	});
});
