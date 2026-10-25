/* The clip inspector's bodies for the free clips layered over the scene reel:
 * text and shapes, b-roll, and audio. One branch per property group, each
 * called from TimelineClipInspector with the context it derived. */
import type { JSX } from "react";
import type { TimelineStageView } from "./timeline-stage.tsx";
import { ShapeContent } from "./shape-content.tsx";
import {
	AudioControls as ClipAudioControls,
	VideoVolumeControl,
	AccordionSection,
	BlendingSection,
	PlaybackSection,
	TransformSection,
} from "./clip-canvas.tsx";
import { ClipFrameTrim } from "./clip-frame-trim.tsx";
import { defaultDuckUnderVoice } from "@maleo/shared/audio-overlays";
import {
	defaultTextStyle,
	type ClipLayout,
	type ClipTextStyle,
} from "@models/timeline/clip-layout.ts";
import { canvasPatchedDoc } from "@models/editor-engine/canvas-document.ts";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { AmountField, FieldRow, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { SourcePlaybackControl } from "./source-playback-control.tsx";
import { GainKeyRow, KeyedFieldRow, KeyGesture, KeyingError } from "./keyed-property-row.tsx";
import { RevealControls } from "./clip-reveal-controls.tsx";
import type { ClipBodyContext } from "./clip-body-context.ts";

const CASINGS = ["none", "upper"] as const;
const CASING_LABEL = { none: "As typed", upper: "UPPERCASE" } satisfies Record<
	(typeof CASINGS)[number],
	string
>;
/** Start and duration on the timeline, as one row. */
function TimelineTimingRow({
	start,
	dur,
	onChange,
}: {
	start: number;
	dur: number;
	onChange: (patch: { start?: number; dur?: number }) => void;
}): JSX.Element {
	return (
		<FieldRow label="Start and duration">
			<AmountField
				label="Start (s)"
				short="At"
				suffix="s"
				min={0}
				step={0.1}
				value={start}
				onChange={(v) => onChange({ start: Math.max(0, v) })}
			/>
			<AmountField
				label="Duration (s)"
				short="Dur"
				suffix="s"
				min={0.1}
				step={0.1}
				value={dur}
				onChange={(v) => onChange({ dur: Math.max(0.1, v) })}
			/>
		</FieldRow>
	);
}

export function textClipBody(
	c: ClipBodyContext,
	kind: "text" | "shape",
	selectedOverlay: NonNullable<TimelineStageView["selectedOverlay"]>,
): JSX.Element {
	const { tab, writers, rowKeying, keyError, totalSec, transform, editHost } = c;
	const { previewFps, brandPalette } = c.view;
	const { updateOverlay } = c.ops;
	const tstyle = selectedOverlay.style ?? defaultTextStyle(selectedOverlay.preset);
	const setStyle = (p: Partial<ClipTextStyle>): void =>
		updateOverlay(selectedOverlay.id, { style: { ...tstyle, ...p } });
	if (tab === "content" && kind === "shape")
		return (
			<KeyGesture writers={writers}>
				<ShapeContent
					overlay={selectedOverlay}
					disabled={c.view.selectedClipLocked}
					brandFill={brandPalette.accentColor}
					onChange={(patch) => updateOverlay(selectedOverlay.id, patch)}
				/>
			</KeyGesture>
		);
	if (tab === "content")
		return (
			<>
				<AccordionSection label="Content & style" defaultOpen>
					<KeyGesture writers={writers}>
						{editHost({ type: "text", id: selectedOverlay.id })}
						<KeyingError error={keyError} />
					</KeyGesture>
				</AccordionSection>
				<AccordionSection label="Case">
					<PropertyRow label="Case">
						<Select
							size="xs"
							value={tstyle.casing ?? "none"}
							onValueChange={onSelect(CASINGS, (casing) => setStyle({ casing }))}
							aria-label={"Case"}
							phoneBreakpoint={860}
							options={[...(CASINGS.map((c) => ({ value: c, label: CASING_LABEL[c] })) ?? [])]}
						/>
					</PropertyRow>
				</AccordionSection>
				<AccordionSection label="Spacing">
					<KeyGesture writers={writers}>
						<KeyedFieldRow
							label="Spacing"
							keying={rowKeying}
							cells={[
								{
									property: "lineHeight",
									label: "Line height",
									short: "LH",
									value: tstyle.lineHeight ?? 1.1,
									min: 0.8,
									max: 2,
									step: 0.05,
									setStatic: (v) => setStyle({ lineHeight: v }),
								},
								{
									property: "letterSpacing",
									label: "Letter spacing",
									short: "LS",
									value: tstyle.letterSpacing ?? 0,
									suffix: "px",
									min: -10,
									max: 40,
									step: 1,
									setStatic: (v) => setStyle({ letterSpacing: v }),
								},
							]}
						/>
						<KeyingError error={keyError} />
					</KeyGesture>
				</AccordionSection>
			</>
		);
	if (tab === "timing")
		return (
			<>
				<AccordionSection label="Trim" defaultOpen>
					<ClipFrameTrim
						start={selectedOverlay.start}
						dur={selectedOverlay.dur}
						fps={previewFps}
						total={totalSec}
						onChange={(p) => updateOverlay(selectedOverlay.id, p)}
					/>
				</AccordionSection>
				<AccordionSection label="Timeline timing">
					<TimelineTimingRow
						start={selectedOverlay.start}
						dur={selectedOverlay.dur}
						onChange={(p) => updateOverlay(selectedOverlay.id, p)}
					/>
				</AccordionSection>
			</>
		);
	const textLayout = (p: Partial<ClipLayout>) =>
		writers.mutate((doc) => canvasPatchedDoc(doc, { source: "text", id: selectedOverlay.id }, p));
	if (tab === "blending")
		return transform(
			<BlendingSection
				layout={selectedOverlay.layout}
				kind="text"
				keying={rowKeying}
				onChange={textLayout}
			/>,
		);
	return (
		<>
			{transform(
				<TransformSection
					layout={selectedOverlay.layout}
					kind="text"
					keying={rowKeying}
					onChange={textLayout}
				/>,
			)}
		</>
	);
}

export function brollClipBody(
	c: ClipBodyContext,
	selectedVideoOverlay: NonNullable<TimelineStageView["selectedVideoOverlay"]>,
): JSX.Element {
	const { tab, writers, keying, rowKeying, keyError, totalSec, transform, compositing, blendMode } =
		c;
	const { editHost, projectId, onProcessingChange, store, library } = c;
	const { previewFps } = c.view;
	const { updateVideoOverlay } = c.ops;
	if (tab === "content")
		return (
			<AccordionSection label="Media" defaultOpen>
				{editHost({ type: "broll", id: selectedVideoOverlay.id })}
			</AccordionSection>
		);
	const brollTarget = { source: "video" as const, id: selectedVideoOverlay.id };
	const brollLayout = (p: Partial<ClipLayout>) =>
		writers.mutate((doc) => canvasPatchedDoc(doc, brollTarget, p));
	if (tab === "timing")
		return (
			<>
				<AccordionSection label="Trim" defaultOpen>
					<ClipFrameTrim
						start={selectedVideoOverlay.start}
						dur={selectedVideoOverlay.dur}
						fps={previewFps}
						total={totalSec}
						onChange={(p) => updateVideoOverlay(selectedVideoOverlay.id, p)}
					/>
				</AccordionSection>
				{selectedVideoOverlay.kind === "video" && (
					<PlaybackSection
						layout={selectedVideoOverlay.layout}
						kind="video"
						onChange={brollLayout}
						control={
							<SourcePlaybackControl
								onProcessingChange={onProcessingChange}
								projectId={projectId}
								target={brollTarget}
								store={store}
								writers={writers}
								library={library}
							/>
						}
					/>
				)}
			</>
		);
	if (tab === "blending")
		return (
			<>
				{transform(
					<BlendingSection
						layout={selectedVideoOverlay.layout}
						kind={selectedVideoOverlay.kind}
						keying={rowKeying}
						blend={blendMode(brollTarget)}
						onChange={brollLayout}
					/>,
				)}
			</>
		);
	if (tab === "masks") return compositing(brollTarget, ["mask"]);
	if (tab === "adjust") return compositing(brollTarget, ["color"]);
	if (tab === "motion")
		return (
			<RevealControls
				reveal={selectedVideoOverlay.reveal}
				clipDurationSec={selectedVideoOverlay.dur}
				onChange={(reveal) => updateVideoOverlay(selectedVideoOverlay.id, { reveal })}
			/>
		);
	if (tab === "audio")
		return (
			<>
				<AccordionSection label="Clip audio" defaultOpen>
					<VideoVolumeControl
						volume={selectedVideoOverlay.volume ?? 0}
						onChange={(v) =>
							updateVideoOverlay(selectedVideoOverlay.id, {
								volume: v,
							})
						}
					/>
				</AccordionSection>
				<KeyGesture writers={writers}>
					<GainKeyRow keying={keying} />
					<KeyingError error={keyError} />
				</KeyGesture>
			</>
		);
	return (
		<>
			{transform(
				<TransformSection
					layout={selectedVideoOverlay.layout}
					kind={selectedVideoOverlay.kind}
					keying={rowKeying}
					onChange={brollLayout}
				/>,
			)}
		</>
	);
}

export function audioClipBody(
	c: ClipBodyContext,
	selectedAudio: NonNullable<TimelineStageView["selectedAudio"]>,
): JSX.Element {
	const { tab, writers, keying, keyError, totalSec, editHost } = c;
	const { projectId, onProcessingChange, store, library } = c;
	const { previewFps } = c.view;
	const { updateAudio } = c.ops;
	if (tab === "content")
		return (
			<AccordionSection label="Source" defaultOpen>
				{editHost({ type: "audio", id: selectedAudio.id })}
			</AccordionSection>
		);
	if (tab === "timing")
		return (
			<>
				<AccordionSection label="Trim" defaultOpen>
					<ClipFrameTrim
						start={selectedAudio.start}
						dur={selectedAudio.dur}
						fps={previewFps}
						total={totalSec}
						onChange={(p) => updateAudio(selectedAudio.id, p)}
					/>
				</AccordionSection>
				<AccordionSection label="Playback" defaultOpen>
					<SourcePlaybackControl
						onProcessingChange={onProcessingChange}
						projectId={projectId}
						target={{ source: "audio", id: selectedAudio.id }}
						store={store}
						writers={writers}
						library={library}
					/>
				</AccordionSection>
				<AccordionSection label="Timeline timing">
					<TimelineTimingRow
						start={selectedAudio.start}
						dur={selectedAudio.dur}
						onChange={(p) => updateAudio(selectedAudio.id, p)}
					/>
				</AccordionSection>
			</>
		);
	return (
		<>
			<AccordionSection label="Levels" defaultOpen>
				<ClipAudioControls
					volume={selectedAudio.volume ?? 1}
					duckUnderVoice={selectedAudio.duckUnderVoice ?? defaultDuckUnderVoice(selectedAudio.kind)}
					showDuck={selectedAudio.kind !== "voiceover"}
					fadeIn={selectedAudio.fadeIn ?? 0}
					fadeOut={selectedAudio.fadeOut ?? 0}
					dur={selectedAudio.dur}
					onChange={(patch) => updateAudio(selectedAudio.id, patch)}
				/>
			</AccordionSection>
			<KeyGesture writers={writers}>
				<GainKeyRow keying={keying} />
				<KeyingError error={keyError} />
			</KeyGesture>
		</>
	);
}
