/* Story generation without providers: the same seams the story suites use
 * (frames, speech, beat authoring, style bible), so a run can approve a plan and
 * generate from it offline. */
import { setStyleBibleGeneratorForTests } from "../../../../../../lib/content-generator.ts";
import { setStoryBeatVisualAuthorForTests } from "../../../../../../lib/story/image-director.ts";
import { setTtsSynthesizerForTests } from "../../../../../../lib/tts-synth.ts";
import { setAssetRetryDelayForTests, setSceneFrameGeneratorForTests } from "../../../visual-gen.ts";
import { setStoryPlan } from "../../../plan-state.ts";
import type { AgentJob } from "../../../model.ts";

export const providerCalls = { frames: 0, speech: 0 };

/** A mono 16 kHz WAV of the given length, so measured durations are real. */
function wavBytes(seconds: number): Uint8Array {
	const byteRate = 16000 * 2;
	const dataSize = Math.max(2, Math.round(byteRate * seconds));
	const bytes = new Uint8Array(44 + dataSize);
	const view = new DataView(bytes.buffer);
	const tag = (offset: number, text: string) => {
		for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i);
	};
	tag(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16000, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	tag(36, "data");
	view.setUint32(40, dataSize, true);
	return bytes;
}

export function installStoryProviders(): void {
	providerCalls.frames = 0;
	providerCalls.speech = 0;
	setAssetRetryDelayForTests(0);
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setSceneFrameGeneratorForTests(async () => `/uploads/frame-${++providerCalls.frames}.png`);
	setTtsSynthesizerForTests(async ({ text }) => {
		providerCalls.speech += 1;
		return { bytes: wavBytes(Math.max(0.5, text.trim().split(/\s+/).length / 2.6)), ext: "wav" };
	});
	setStoryBeatVisualAuthorForTests(async (_section, beats) =>
		beats.map((beat, index) => ({
			beatIndex: index,
			visualMoment: `visual ${index + 1}: ${beat.text.slice(0, 30)}`,
			endState: `end ${index + 1}`,
		})),
	);
}

export function removeStoryProviders(): void {
	setStyleBibleGeneratorForTests(null);
	setSceneFrameGeneratorForTests(null);
	setTtsSynthesizerForTests(null);
	setStoryBeatVisualAuthorForTests(null);
}

/** Give a video run a short, unapproved plan. */
export function draftShortPlan(job: AgentJob): void {
	setStoryPlan(
		job,
		8,
		[
			{
				id: "sec-1",
				title: "Last watch",
				narration:
					"The keeper climbs the tower one last time and lights the lamp for the ships still out at sea.",
				visualPrompt: "a lighthouse keeper climbing a spiral stair at dusk",
				estimatedDurationSec: 8,
			},
		],
		false,
		false,
		{
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		},
	);
}
