/* Applying a settled agent run that carries the commands it executed
 * (`move-agent-tools-to-editor-commands`).
 *
 * The run edited an existing timeline through editor commands, so there is nothing
 * to merge or diff: the editor applies exactly those commands, as one undo step,
 * with the media they place admitted alongside. What remains is the same fencing a
 * merged result gets — a command must not overwrite a clip the user changed while
 * the run worked — plus one case a merge never meets: an insert whose id the user
 * has taken since, which `clip.insert` would otherwise duplicate. */
import type { ChatEntityRef, EntityFingerprint, Clip } from "@maleo/shared";
import {
	batch,
	commandClipIds,
	commandInsertedClipIds,
	setMediaAssets,
	type EditorCommand,
	type EditScope,
	type MediaAsset,
} from "@maleo/shared/editor";
import { fenceTouchedResult } from "@models/timeline/agent-result-scope.ts";
import {
	seedForArtifact,
	seedForGeneratedAudio,
	seedForGeneratedVideo,
} from "@models/timeline/media-seeds.ts";
import type { AdmitMedia } from "./apply-agent-job.ts";

/** The clips the commands write, in first-mention order. */
export function commandClipRefs(
	commands: readonly EditorCommand[],
	clips: readonly Clip[] = [],
): ChatEntityRef[] {
	return commandClipIds(commands, clips).map((id) => ({ kind: "clip", id }));
}

/* An inserted clip's media, admitted the way the merge admits it, so the clip
 * carries its asset id. Every other command passes through unchanged. */
function admitted(command: EditorCommand, admit: AdmitMedia): EditorCommand {
	if (command.type === "batch")
		return { ...command, commands: command.commands.map((c) => admitted(c, admit)) };
	if (command.type !== "clip.insert") return command;
	const { clip } = command;
	if (clip.video?.url) {
		const v = clip.video;
		const seed =
			v.kind === "video"
				? seedForGeneratedVideo({ url: v.url, label: v.label, durationSec: v.dur })
				: seedForArtifact({ url: v.url, mediaType: "image", label: v.label, durationSec: v.dur });
		return { ...command, clip: { ...clip, video: { ...v, mediaAssetId: admit(seed) } } };
	}
	if (clip.audio?.url) {
		const a = clip.audio;
		return {
			...command,
			clip: {
				...clip,
				audio: {
					...a,
					mediaAssetId: admit(
						seedForGeneratedAudio({
							url: a.url!,
							content: a.content,
							kind: a.kind,
							durationSec: a.dur,
						}),
					),
				},
			},
		};
	}
	return command;
}

export type CommandSettle =
	| { status: "apply"; command: EditorCommand; touched: ChatEntityRef[] }
	| {
			status: "hold";
			reason: "changed" | "deleted";
			conflicts: ChatEntityRef[];
			touched: ChatEntityRef[];
	  };

/** Fence a run's commands against the live scope and, when they may apply, build
 *  the one command that applies them. Admission happens only when they may. */
export function settleAgentCommands(input: {
	commands: readonly EditorCommand[];
	captured: EntityFingerprint[];
	current: EditScope;
	admit: AdmitMedia;
	mediaAssets: () => MediaAsset[];
	label: string;
}): CommandSettle {
	const { commands, captured, current } = input;
	const touched: ChatEntityRef[] = commandClipIds(commands, current.doc.clips, captured).map(
		(id) => ({ kind: "clip", id }),
	);
	const existing = new Set(current.doc.clips.map((clip) => clip.id));
	const taken = commandInsertedClipIds(commands)
		.filter((id) => existing.has(id))
		.map((id) => ({ kind: "clip" as const, id }));
	if (taken.length) return { status: "hold", reason: "changed", conflicts: taken, touched };
	// Nothing captured means a run from before baselines were recorded; there is
	// nothing to compare, and the executor still refuses a missing target.
	if (captured.length) {
		const decision = fenceTouchedResult(captured, current, touched);
		if (decision.status === "hold") return { ...decision, touched };
	}
	const placed = commands.map((command) => admitted(command, input.admit));
	const media = input.mediaAssets();
	return {
		status: "apply",
		command: batch(
			media === current.mediaAssets ? placed : [...placed, setMediaAssets(media)],
			input.label,
		),
		touched,
	};
}
