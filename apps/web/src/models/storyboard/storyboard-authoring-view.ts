import type { StorySemanticBeat, StoryboardGenerationState } from "@maleo/shared";
import { fieldOf, textOf } from "@maleo/shared";
import type { GeneratedByBeatId } from "./storyboard-controller.ts";

export type StoryboardViewPhase =
	| "loading"
	| "failed"
	| "empty"
	| "legacy"
	| "draft"
	| "approved"
	| "generating"
	| "conflict";

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && Boolean(item))
		: [];
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

export interface StoryboardBeatOutput {
	images: Array<{ url: string; stale: boolean }>;
	voices: Array<{ url: string; durationSec?: number; stale: boolean }>;
	status: string;
	error?: string;
	voiceDirection?: string;
	pacing?: string;
	emotion?: string;
}

export function storyboardPhase(input: {
	state: StoryboardGenerationState | null;
	legacy: boolean;
	loading: boolean;
	error: string | null;
	conflict: unknown;
	generatedByBeatId: GeneratedByBeatId;
}): StoryboardViewPhase {
	if (input.loading) return "loading";
	if (input.error) return "failed";
	if (input.conflict) return "conflict";
	if (!input.state) return "empty";
	if (input.legacy) return "legacy";
	const generated = Object.values(input.generatedByBeatId).flat();
	if (
		generated.some((section) =>
			["pending", "voicing", "imaging"].includes(textOf(fieldOf(section, "status"))),
		)
	)
		return "generating";
	return input.state.approvedSnapshot ? "approved" : "draft";
}

export function storyboardBeatOutput(
	generated: readonly Readonly<Record<string, unknown>>[],
	approvedRevisionId?: string,
	beat?: StorySemanticBeat,
): StoryboardBeatOutput {
	const output = generated[0] ?? {};
	const imageUrls = generated.flatMap((section) => strings(fieldOf(section, "imageUrls")));
	const imageUrl = text(fieldOf(output, "imageUrl"));
	if (!imageUrls.length && imageUrl) imageUrls.push(imageUrl);
	const imageRevisions = generated.flatMap((section) =>
		strings(fieldOf(section, "imageSourceRevisionIds")),
	);
	const voices = generated.flatMap((section) => {
		const rawVoices = fieldOf(section, "voiceSegments");
		return Array.isArray(rawVoices)
			? rawVoices.flatMap((item: unknown) => {
					const url = text(fieldOf(item, "audioUrl"));
					if (!url) return [];
					const duration = fieldOf(item, "audioDurationSec");
					const revision = text(fieldOf(item, "sourceRevisionId"));
					return [
						{
							url,
							durationSec: typeof duration === "number" ? duration : undefined,
							stale: Boolean(approvedRevisionId && revision !== approvedRevisionId),
						},
					];
				})
			: [];
	});
	const audioUrl = text(fieldOf(output, "audioUrl"));
	if (!voices.length && audioUrl) {
		const duration = fieldOf(output, "audioDurationSec");
		const revision = text(fieldOf(output, "sourceRevisionId"));
		voices.push({
			url: audioUrl,
			durationSec: typeof duration === "number" ? duration : undefined,
			stale: Boolean(approvedRevisionId && revision !== approvedRevisionId),
		});
	}
	return {
		images: imageUrls.map((url, index) => ({
			url,
			stale: Boolean(approvedRevisionId && imageRevisions[index] !== approvedRevisionId),
		})),
		voices,
		status: text(fieldOf(output, "status")) ?? "draft",
		error: text(fieldOf(output, "error")),
		voiceDirection: beat && (text(fieldOf(beat, "voiceDirection")) ?? text(fieldOf(beat, "voice"))),
		pacing: beat && text(fieldOf(beat, "pacing")),
		emotion: beat && text(fieldOf(beat, "emotion")),
	};
}

export function storyboardChatInstruction(
	action: "rewrite" | "improve" | "regenerate",
	beatId: string,
): string {
	return `${action} storyboard beat with stable id ${JSON.stringify(beatId)}. Change only that beat; preserve every unrelated beat.`;
}

export function splitBeatNarration(narration: string): [string, string] {
	const words = narration.trim().split(/\s+/).filter(Boolean);
	const at = Math.max(1, Math.ceil(words.length / 2));
	return [words.slice(0, at).join(" "), words.slice(at).join(" ")];
}
