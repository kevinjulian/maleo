import { describe, expect, test } from "bun:test";
import { setKeyframes, setKeyframesArgs } from "./set-keyframes.ts";
import { agentEditorViews } from "../../document.ts";
import type { AgentJob } from "../../model.ts";
import type { ToolContext } from "../../types.ts";

function job(): AgentJob {
	return {
		id: "job-keys",
		projectId: "p",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [
			{ name: "Hook", durationSec: 6, image: "/uploads/a.png" },
			{
				name: "Beat",
				durationSec: 6,
				visualClips: [
					{
						id: "a",
						kind: "image",
						url: "a.png",
						label: "A",
						startSec: 0,
						durationSec: 2,
						primary: true,
					},
					{ id: "b", kind: "image", url: "b.png", label: "B", startSec: 2, durationSec: 4 },
				],
			},
		],
		textOverlays: [
			{
				content: "Title",
				startSec: 0,
				durationSec: 4,
				layout: { xPct: 10, yPct: 60, widthPct: 80, fit: "contain" },
			},
		],
		videoOverlays: [{ url: "b.mp4", kind: "video", startSec: 1, durationSec: 3 }],
		audioOverlays: [],
		infographicOverlays: [],
	} as unknown as AgentJob;
}
const run = (j: AgentJob, args: unknown) =>
	setKeyframes.handler!(
		{ job: j, helpers: {} } as unknown as ToolContext,
		setKeyframesArgs.parse(args),
	);

describe("set_keyframes", () => {
	test("a slow scale-up lands as ordinary keys on the scene's primary visual and reaches the document views", async () => {
		const j = job();
		const result = await run(j, {
			target: "scene",
			index: 0,
			property: "scale",
			keys: [
				{ t: 5, v: 1.25, easing: "in-out" },
				{ t: 2, v: 1 },
			],
		});
		expect(result.note).toBe("Keyed scale on scene 1 at 2s, 5s");
		const views = agentEditorViews(j);
		expect(views.scenes[0]?.visualClips?.[0]?.layout?.animation?.tracks.scale).toEqual([
			{ t: 2, v: 1 },
			{ t: 5, v: 1.25, easing: "in-out" },
		]);
	});

	test("text and overlay clips keep their box and gain the track", async () => {
		const j = job();
		await run(j, {
			target: "text",
			index: 0,
			property: "fontSize",
			keys: [
				{ t: 0, v: 40 },
				{ t: 1, v: 64 },
			],
		});
		await run(j, {
			target: "video",
			index: 0,
			property: "volume",
			keys: [
				{ t: 0, v: 1 },
				{ t: 3, v: 0 },
			],
		});
		const views = agentEditorViews(j);
		expect(views.textOverlays[0]?.layout).toMatchObject({
			xPct: 10,
			yPct: 60,
			animation: {
				tracks: {
					fontSize: [
						{ t: 0, v: 40 },
						{ t: 1, v: 64 },
					],
				},
			},
		});
		expect(views.videoOverlays[0]?.layout?.animation?.tracks.volume).toHaveLength(2);
		await run(j, { target: "text", index: 0, property: "fontSize", keys: [] });
		expect(agentEditorViews(j).textOverlays[0]?.layout).toEqual({
			xPct: 10,
			yPct: 60,
			widthPct: 80,
			fit: "contain",
		});
	});

	test("refusals name the problem and change nothing", async () => {
		const j = job(),
			before = JSON.stringify(j);
		expect(
			(await run(j, { target: "video", index: 0, property: "scale", keys: [{ t: 9, v: 2 }] })).note,
		).toBe("Refused: Keyframe at 9s is outside the clip (0–3s)");
		expect(
			(await run(j, { target: "scene", index: 1, property: "xPct", keys: [{ t: 3, v: 0 }] })).note,
		).toContain("(0–2s)");
		expect(
			(await run(j, { target: "scene", index: 0, property: "scale", keys: [{ t: 1, v: 50 }] }))
				.note,
		).toContain("not valid for this image clip");
		expect(
			(await run(j, { target: "scene", index: 0, property: "fontSize", keys: [{ t: 1, v: 40 }] }))
				.note,
		).toContain("not valid");
		expect((await run(j, { target: "text", index: 4, property: "opacity", keys: [] })).note).toBe(
			"Refused: No text overlay at index 4",
		);
		expect(JSON.stringify(j)).toBe(before);
		expect(
			setKeyframesArgs.safeParse({ target: "text", index: 0, property: "warp", keys: [] }).success,
		).toBe(false);
	});
});
