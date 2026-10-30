/* The timeline editor's chat: the shared `ChatPanel`, wired to this editor.
 *
 * Two housings read it — the rail panel on desktop and the Chat view of the
 * phone workspace — so the wiring is written once. The phone view is not a
 * second chat; it is this one, somewhere else. */
import type { JSX } from "react";
import { ChatPanel } from "@components/editor/editor-chat.tsx";
import { timelineJumpFor } from "@models/chat/chat-focus-descriptors.ts";
import { seedForArtifact } from "@models/timeline/media-seeds.ts";
import { critiqueStoryboard } from "@models/content/engage-actions.ts";
import { selectDerivedArrays, useDocumentSelector } from "@stores/timeline-document-store.ts";
import type { TimelinePanelHostProps } from "./timeline-panel-host.tsx";

export interface TimelineChatPanelProps extends Pick<
	TimelinePanelHostProps,
	"store" | "writers" | "library" | "chat" | "projectId" | "ops" | "view"
> {
	onClose: () => void;
	/** Called when chat takes the user to the editor — a jump, a seek, `Show
	 *  changes`. The phone uses it to switch to the Editor view first. */
	onShowEditor?: () => void;
}

export function TimelineChatPanel({
	store,
	writers,
	library,
	chat,
	projectId,
	ops,
	view,
	onClose,
	onShowEditor,
}: TimelineChatPanelProps): JSX.Element {
	const { scenes, audioOverlays, textOverlays } = useDocumentSelector(store, selectDerivedArrays);
	const { setAudioOverlays, setVideoOverlays } = writers;
	const jumpToClip: typeof ops.jumpToClip = (ref) => {
		onShowEditor?.();
		ops.jumpToClip(ref);
	};
	return (
		<ChatPanel
			scenes={scenes}
			audioOverlays={audioOverlays}
			messages={chat.messages}
			setMessages={chat.setMessages}
			onRunCommand={chat.run}
			model={chat.model}
			onAnswerQuestion={chat.answer}
			busy={chat.running}
			onStop={chat.stop}
			interrupted={chat.interrupted}
			onResume={chat.resume}
			projectId={projectId}
			onJump={jumpToClip}
			editor={chat.editor}
			onReveal={(refs) => {
				// The first touched entity the timeline can show becomes the
				// selection, and the playhead moves to it.
				const jump = refs.map(timelineJumpFor).find((candidate) => candidate != null);
				if (jump) jumpToClip(jump);
			}}
			onSeek={(sec) => {
				onShowEditor?.();
				ops.seekPreview(sec);
			}}
			onCritique={() => {
				const { inputs, timedScenes } = view.buildPacingInputs();
				return {
					title: "Pacing critique",
					findings: critiqueStoryboard(
						inputs,
						timedScenes,
						textOverlays.map((t) => ({ start: t.start, dur: t.dur })),
					),
				};
			}}
			onAddArtifact={(a) => {
				const start = Math.max(
					0,
					Math.min(view.playhead.get(), Math.max(0, view.total - (a.durationSec ?? 3))),
				);
				// An artifact the chat produced is media the project holds, so it is
				// admitted before it is placed — the same rule the drag path follows.
				const mediaAssetId = library.ensureMediaAsset(
					seedForArtifact({
						url: a.url,
						mediaType: a.mediaType,
						label: a.label,
						durationSec: a.durationSec,
					}),
				);
				if (a.mediaType === "audio")
					setAudioOverlays((prev) => [
						...prev,
						{
							id: Date.now(),
							kind: "voiceover",
							content: a.label ?? "Voice",
							url: a.url,
							mediaAssetId,
							start,
							dur: a.durationSec ?? 4,
						},
					]);
				else if (a.mediaType === "video")
					setVideoOverlays((prev) => [
						...prev,
						{
							id: Date.now(),
							url: a.url,
							mediaAssetId,
							kind: "video",
							label: a.label,
							start,
							dur: a.durationSec ?? 5,
							track: 0,
							source: "generated",
						},
					]);
				else ops.addSceneWithMedia(a.url, mediaAssetId);
			}}
			onClose={onClose}
		/>
	);
}
