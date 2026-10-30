import { useEffect, useState } from "react";
import {
	edgeAnimation,
	edgeAnimationState,
	timelineVisualSpans,
	validTransition,
	withoutTransitions,
	type EdgePreset,
	type TransitionType,
} from "@maleo/shared";
import { Button } from "@design-system/components/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "@design-system/components/toggle-group.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { Slider } from "@design-system/components/slider.tsx";
import { Note } from "@design-system/components/note.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import {
	animationTargetForId,
	applyEdgePreset,
	clipAnimationInfo,
} from "@models/timeline/clip-animation-edit.ts";
import type { AnimationInspectorTarget } from "@stores/editor-chrome-store.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { TimelineStageOps, TimelineStageView } from "./timeline-stage.tsx";
import { KeyGesture } from "./keyed-property-row.tsx";

type AnimationInspectorProps = {
	request: AnimationInspectorTarget;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	ops: TimelineStageOps;
	view: TimelineStageView;
};
type ReplayWindow = { start: number; end: number };

export function ClipAnimationInspector(props: AnimationInspectorProps) {
	const { request, view } = props;
	const identity =
		"clipId" in request ? request.clipId : `${request.fromClipId}:${request.toClipId}`;
	const [replay, setReplay] = useState<(ReplayWindow & { identity: string }) | null>(null);
	useEffect(() => {
		if (!view.previewMedia.readiness.ready) {
			setReplay(null);
			return;
		}
		const player = view.playerRef.current;
		if (!player || !replay || replay.identity !== identity || !view.previewMedia.readiness.ready)
			return;
		const end = Math.ceil(replay.end * view.previewFps);
		const stop = ({ detail }: { detail: { frame: number } }) => {
			if (detail.frame >= end) {
				player.pause();
				setReplay(null);
			}
		};
		player.addEventListener("frameupdate", stop);
		const frame = requestAnimationFrame(() => {
			view.seekPreview(replay.start);
			player.play();
		});
		return () => {
			cancelAnimationFrame(frame);
			player.removeEventListener("frameupdate", stop);
			player.pause();
		};
	}, [replay, identity, view.playerRef, view.previewFps, view.previewMedia.readiness.ready]);
	const onReplay = (window: ReplayWindow | null) => setReplay(window && { ...window, identity });
	return (
		<div
			role="region"
			aria-label={"clipId" in request ? "Animation settings" : "Transition settings"}
		>
			{"clipId" in request ? (
				(["in", "out"] as const).map((edge) => (
					<AnimationSection
						key={`${identity}:${edge}`}
						{...props}
						request={{ clipId: request.clipId, edge }}
						onReplay={onReplay}
					/>
				))
			) : (
				<AnimationSection key={identity} {...props} onReplay={onReplay} />
			)}
		</div>
	);
}

function AnimationSection({
	request,
	store,
	writers,
	ops,
	view,
	onReplay,
}: AnimationInspectorProps & { onReplay: (window: ReplayWindow | null) => void }) {
	const doc = useDocumentSelector(store, (s) => s.getDoc());
	const [duration, setDuration] = useState(0.4);
	const target = "clipId" in request ? animationTargetForId(doc, request.clipId) : undefined;
	const info = target ? clipAnimationInfo(doc, target) : undefined;
	const pair = "fromClipId" in request ? request : undefined;
	const spans = timelineVisualSpans(doc),
		a = pair && spans.find((c) => c.id === pair.fromClipId),
		b = pair && spans.find((c) => c.id === pair.toClipId);
	const transition =
		pair &&
		doc.clips.find(
			(c) =>
				c.transition?.fromClipId === pair.fromClipId && c.transition?.toClipId === pair.toClipId,
		)?.transition;
	const edge = "edge" in request ? request.edge : "in";
	const ramp = info && edgeAnimation(info.animation, edge, info.duration, info.values, info.audio);
	const max = info ? info.duration / 2 : a && b ? Math.min(a.dur, b.dur) : 0;
	const seconds = Math.min(max, ramp?.duration ?? transition?.dur ?? duration);
	const locked =
		info?.locked ||
		Boolean((a && doc.trackFlags?.[a.track]?.locked) || (b && doc.trackFlags?.[b.track]?.locked));
	const available = Boolean(
		info || (pair && validTransition({ ...pair, id: 0, type: "cut", dur: 0.4 }, spans)),
	);
	const name = (id: string) => {
		const clip = doc.clips.find((c) => c.id === id);
		return clip?.scene?.name ?? clip?.vis?.vclip.label ?? clip?.video?.label ?? id;
	};
	const preset = pair
		? (transition?.type ?? "cut")
		: info
			? edgeAnimationState(info.animation, edge, info.duration, info.values, info.audio)
			: "none";
	const play = (time = seconds) => {
		if (!view.previewMedia.readiness.ready) return;
		const window = info
			? Math.min(info.duration, Math.max(time + 0.3, 0.8))
			: Math.max(0.8, time + 0.6);
		const start = info
			? info.start + (edge === "out" ? Math.max(0, info.duration - window) : 0)
			: Math.max(0, (b?.start ?? 0) - 0.3);
		onReplay({ start, end: Math.min(view.previewFrames / view.previewFps, start + window) });
	};
	const choose = (
		type: EdgePreset | TransitionType,
		nextDuration = seconds,
		preview = true,
	): void => {
		if (locked || !available) return;
		if (target && info) {
			if (type !== "none" && type !== "fade" && type !== "slide" && type !== "zoom") return;
			writers.apply((scope) => applyEdgePreset(scope, target, edge, type, nextDuration));
		} else if (pair && type !== "none") {
			if (type === "cut") {
				if (transition) writers.mutate((d) => withoutTransitions(d, new Set([transition.id])));
			} else ops.upsertTransition(pair.fromClipId, pair.toClipId, { type, dur: nextDuration });
		}
		if (preview) play(nextDuration);
	};
	const changeDuration = (value: number) => {
		const next = Math.max(Math.min(1 / view.previewFps, max), Math.min(max, value));
		setDuration(next);
		if (preset !== "none" && preset !== "cut" && preset !== "custom") choose(preset, next, false);
	};
	const options: (EdgePreset | TransitionType)[] = pair
		? ["cut", "fade", "slide", "zoom", "wipe", "flip", "clock_wipe", "pixel"]
		: info?.audio
			? ["none", "fade"]
			: ["none", "fade", "slide", "zoom"];
	const label = (type: string) =>
		type === "none" || type === "cut"
			? "None"
			: type === "fade" && pair
				? "Dissolve"
				: type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
	const title = pair ? "Transition" : edge === "in" ? "Entrance" : "Exit";
	return (
		<>
			{pair && (
				<Note>
					{name(pair.fromClipId)} → {name(pair.toClipId)}
				</Note>
			)}
			{!available ? (
				<Note>Move visual clips together on the same track to add a transition.</Note>
			) : (
				<>
					{locked && <Note>Track locked. Unlock the track to edit animation.</Note>}
					<InspectorSection
						title={title}
						collapsible
						summary={preset === "none" || preset === "cut" ? undefined : label(preset)}
					>
						<ToggleGroup
							layout="tiles"
							aria-label={`${title} presets`}
							className="tl2-animation-presets"
							value={preset}
							onValueChange={(value) => {
								if (value !== "custom") choose(value);
							}}
							size="sm"
							disabled={locked}
						>
							{options.map((type) => (
								<ToggleGroupItem
									key={type}
									value={type}
									className="tl2-animation-tile"
									disabled={preset === "custom" && type === "none"}
								>
									<svg className="tl2-animation-diagram" viewBox="0 0 64 40" aria-hidden="true">
										{type === "none" || type === "cut" ? (
											<>
												<circle cx="32" cy="20" r="10" fill="none" stroke="currentColor" />
												<path d="M25 13l14 14" stroke="currentColor" />
											</>
										) : (
											<>
												<rect
													className="tl2-animation-plate"
													x="9"
													y="7"
													width="34"
													height="26"
													rx="3"
												/>
												<rect
													className={`tl2-animation-sample ${type}`}
													x="21"
													y="7"
													width="34"
													height="26"
													rx="3"
												/>
											</>
										)}
									</svg>
									<span>{label(type)}</span>
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						<KeyGesture writers={writers}>
							<PropertyRow label="Duration" as="div">
								<span className="tl2-animation-duration">
									<Slider
										aria-label={`${title} duration slider`}
										min={Math.min(1 / view.previewFps, max)}
										max={max}
										step={0.05}
										value={seconds}
										disabled={locked}
										onChange={(e) => changeDuration(Number(e.target.value))}
									/>
									<NumberField
										aria-label={`${title} duration`}
										value={seconds}
										min={Math.min(1 / view.previewFps, max)}
										max={max}
										step={0.05}
										suffix="s"
										disabled={locked}
										onValueChange={changeDuration}
									/>
								</span>
							</PropertyRow>
						</KeyGesture>
						{transition && (
							<PropertyRow label="Color phase">
								<NumberField
									aria-label="Color phase"
									value={transition.colorPhase ?? 0}
									min={0}
									max={1}
									step={0.05}
									disabled={locked}
									onValueChange={(colorPhase) =>
										ops.updateTransition(transition.id, { colorPhase })
									}
								/>
							</PropertyRow>
						)}
						<Button
							size="sm"
							variant="ghost"
							disabled={!view.previewMedia.readiness.ready}
							onClick={() => play()}
						>
							Replay in preview
						</Button>
					</InspectorSection>
				</>
			)}
		</>
	);
}
