/* Motion Studio — modal editor for reusable motions.
 * Layout: live preview (top left, brand background + transport) · inspector
 * (top right) · layer timeline (bottom, ruler + playhead + curve/mark lanes).
 *
 * ONE set of value inputs. Editing a value writes a keyframe at the playhead
 * (auto-key): the first edit of a property seeds its base at t=0. X/Y inputs
 * are layout-linked — at t=0 with no track they simply move the layer;
 * afterwards they keyframe an offset from the base position.
 * Selecting a keyframe mark on a curve lane focuses it: every input disables
 * except the one for that curve, which then edits the mark (plus easing and
 * delete). Same evalTrack the renderer samples — preview == export. */
import { useCallback, useMemo, useRef, useState, type JSX } from "react";
import { evalColorTrack, evalTrack } from "@maleo/video/composition";
import type {
	AnimatableProp,
	ColorAnimatableProp,
	ColorKeyframe,
	MotionEasing,
	CompositionLayer,
	TextPreset,
	ValueKeyframe,
} from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { saveCompositionTemplate } from "@api/templates.ts";
import {
	useMotionTimeline,
	type MotionTimelineRow,
} from "@components/timeline/motion/motion-timeline.tsx";
import {
	motionStateOf,
	normalizedTimeIn,
	parseMotionMarkerId,
} from "@models/timeline/motion-document-adapter.ts";
import {
	buildMotionRendererProps,
	buildMotionSaveInput,
	buildMotionVuiLanes,
	motionLayerIdFromRow,
	parseMotionTrackRow,
	persistMotionSave,
	shiftMotionKeyframe,
	type MotionMarkSelection,
	type MotionStudioTrack,
} from "@models/timeline/motion-vui-adapter.ts";
import { VuiEditorWorkspace } from "@components/editor-workspace/workspace.tsx";
import { VuiKeyboardScope } from "@components/editor-workspace/keyboard-scope.tsx";
import {
	VuiInspectorRail,
	VuiPreviewStage,
	type VuiInspectorCategory,
} from "@components/editor-workspace/primitives.tsx";
import { AccordionSection } from "../inspector-section.tsx";
import { StudioActionBar } from "../studio-action-bar.tsx";
import { MotionToolbar } from "./motion-toolbar.tsx";
import {
	MOTION_IDENTITY_SECTION,
	MOTION_LAYER_SECTIONS,
	type MotionLayerSectionKey,
} from "./motion-layer-sections.tsx";
import { StudioHeading } from "../studio-heading.tsx";
import { VuiRemotionPreview } from "@components/timeline/remotion-preview.tsx";
import { useRemotionPlayhead } from "@hooks/timeline/use-remotion-playhead.ts";
import { useFollowPlayhead } from "@hooks/timeline/use-follow-playhead.ts";
import { useGutterScrollSync } from "@hooks/timeline/use-gutter-scroll-sync.ts";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { usePlayheadSec } from "@hooks/timeline/use-playhead.ts";
import { useStudioModalActive } from "@models/timeline/studio-modal-active.ts";
import { DEFAULT_BRAND, type BrandPalette } from "@models/timeline/panel-brand.ts";
import { Button } from "@design-system/components/button.tsx";
import {
	PROP_BASE,
	clamp01,
	layerLabel,
	newLayer,
	sortColorKfs,
	sortKfs,
} from "./motion-keyframes.ts";
import { layerIcon } from "./motion-curve.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import {
	colorBase,
	colorTrackPatch,
	markSelection,
	onTrack,
	valueTrackPatch,
} from "./motion-studio-edits.ts";
import { MotionLayerInspector } from "./motion-layer-inspector.tsx";
import { MotionStudioTimeline } from "./motion-studio-timeline.tsx";

interface MotionStudioModalProps {
	aspect: number;
	brand?: BrandPalette;
	/** Present when editing an existing motion — save targets this template. */
	initial?: { id?: string; name: string; overlays: CompositionLayer[]; spanSec?: number };
	onClose: () => void;
	onSaved: () => void;
}

type MarkSel = MotionMarkSelection;
type StudioTrack = MotionStudioTrack;

export function MotionStudioModal({
	aspect,
	brand = DEFAULT_BRAND,
	initial,
	onClose,
	onSaved,
}: MotionStudioModalProps): JSX.Element {
	useStudioModalActive();
	/* One answer for the whole editor — see use-phone-layout.ts. Each studio used
	   to declare this query itself, so between 700 and 860 the main editor
	   composed as a phone while the studios composed as desktops, in the same
	   window. Short landscape is covered by the width too: 852 is under the
	   breakpoint. */
	const compact = usePhoneLayout();
	const [name, setName] = useState(initial?.name ?? "");
	const [durationSec, setDurationSec] = useState(() => {
		if (initial?.spanSec !== undefined) return initial.spanSec;
		const span = initial ? Math.max(...initial.overlays.map((o) => o.start + o.dur), 0) : 0;
		return Math.max(1, Math.round((span || 3) * 10) / 10);
	});
	const [layers, setLayers] = useState<CompositionLayer[]>(() =>
		initial?.overlays.length ? initial.overlays.map((o) => ({ ...o })) : [newLayer("plain", 3)],
	);
	const [selectedId, setSelectedId] = useState<number | null>(
		() => initial?.overlays[0]?.id ?? null,
	);
	const [mark, setMark] = useState<MarkSel | null>(null);
	// Rail shows the motion-identity form (pencil) or a layer's editor. Layer
	// selection is the rail category; each layer is its own category.
	const [identityMode, setIdentityMode] = useState(false);
	const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
	/* Which inspector section is open, and a key that re-focuses it.
	 *
	 * One at a time, and controlled, because the bottom bar's controls promise to
	 * open the inspector AT a section — a panel of permanently-open accordions
	 * cannot honour that. Template Studio already worked this way; this is Motion
	 * Studio joining it rather than a third inspector model. */
	/* Controlled only in the compact composition. A docked panel has room for
	 * every section at once and that is how this studio has always read; the
	 * phone's sheet does not, and its bar promises to open the inspector AT a
	 * section, which a panel of permanently-open accordions cannot honour. So
	 * desktop stays uncontrolled and phone drives this. */
	const [openSection, setOpenSection] = useState<MotionLayerSectionKey | "identity">("identity");
	const [sectionFocusKey, setSectionFocusKey] = useState(0);
	const focusSection = (k: MotionLayerSectionKey | "identity"): void => {
		setOpenSection(k);
		setSectionFocusKey((key) => key + 1);
	};
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const rendererProps = useMemo(
		() => buildMotionRendererProps(layers, durationSec, aspect, brand),
		[layers, durationSec, aspect, brand],
	);
	const durationFrames = rendererProps.durationInFrames;
	/* The ref comes from the hook: it has to observe the player ARRIVING, which a
	   ref created here cannot report. See use-remotion-playhead.ts. */
	const { playhead, playing, seek, togglePlay, playerRef } = useRemotionPlayhead(
		rendererProps.fps,
		durationFrames,
	);
	/* This surface DISPLAYS the time, so it subscribes — see playhead-handle.ts. */
	const playheadSec = usePlayheadSec(playhead);

	const selected = layers.find((l) => l.id === selectedId) ?? null;
	const selectLayerForInspector = (id: number): void => {
		setSelectedId(id);
		setMark(null);
		setIdentityMode(false);
	};
	const upd = (id: number, patch: Partial<CompositionLayer>): void => {
		setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	};

	const addLayer = (preset: TextPreset): void => {
		const layer = newLayer(preset, durationSec);
		setLayers((ls) => [...ls, { ...layer, track: ls.length }]);
		setSelectedId(layer.id);
		setMark(null);
		setIdentityMode(false);
	};

	const removeLayer = (id: number): void => {
		setLayers((ls) => ls.filter((l) => l.id !== id));
		if (selectedId === id) setSelectedId(null);
		if (mark?.layerId === id) setMark(null);
	};

	// ── keyframe ops on the selected layer ──
	const progress =
		selected && selected.dur > 0 ? clamp01((playheadSec - selected.start) / selected.dur) : 0;

	const setTrack = (
		layer: CompositionLayer,
		prop: AnimatableProp,
		kfs: ValueKeyframe[] | undefined,
	): void => upd(layer.id, valueTrackPatch(layer, prop, kfs));
	const setColorTrack = (
		layer: CompositionLayer,
		prop: ColorAnimatableProp,
		kfs: ColorKeyframe[] | undefined,
	): void => upd(layer.id, colorTrackPatch(layer, prop, kfs));

	const moveMark = (sel: MarkSel, t: number): void => {
		onTrack(
			layers.find((l) => l.id === sel.layerId),
			sel,
			(layer, kfs, prop) => {
				const next = shiftMotionKeyframe(kfs, sel.index, t);
				if (next) setTrack(layer, prop, next);
			},
			(layer, kfs, prop) => {
				const next = shiftMotionKeyframe(kfs, sel.index, t);
				if (next) setColorTrack(layer, prop, next);
			},
		);
	};

	const addMark = (layerId: number, track: StudioTrack, t: number): void => {
		const ct = clamp01(t);
		onTrack(
			layers.find((l) => l.id === layerId),
			track,
			(layer, kfs, prop) =>
				setTrack(
					layer,
					prop,
					sortKfs([...kfs, { t: ct, v: evalTrack(kfs, ct, PROP_BASE[prop]), easing: "linear" }]),
				),
			(layer, kfs, prop) =>
				setColorTrack(
					layer,
					prop,
					sortColorKfs([
						...kfs,
						{ t: ct, v: evalColorTrack(kfs, ct, colorBase(layer, prop)), easing: "linear" },
					]),
				),
		);
	};

	const deleteMark = (): void => {
		if (!mark) return;
		const sel = mark;
		// A track with one keyframe left animates nothing, so removing that one
		// clears the track rather than leaving an empty array behind.
		onTrack(
			layers.find((l) => l.id === sel.layerId),
			sel,
			(layer, kfs, prop) =>
				setTrack(layer, prop, kfs.length <= 1 ? undefined : kfs.filter((_, i) => i !== sel.index)),
			(layer, kfs, prop) =>
				setColorTrack(
					layer,
					prop,
					kfs.length <= 1 ? undefined : kfs.filter((_, i) => i !== sel.index),
				),
		);
		setMark(null);
	};

	const setMarkEasing = (easing: MotionEasing): void => {
		if (!mark) return;
		const sel = mark;
		onTrack(
			layers.find((l) => l.id === sel.layerId),
			sel,
			(layer, kfs, prop) =>
				setTrack(
					layer,
					prop,
					kfs.map((k, i) => (i === sel.index ? { ...k, easing } : k)),
				),
			(layer, kfs, prop) =>
				setColorTrack(
					layer,
					prop,
					kfs.map((k, i) => (i === sel.index ? { ...k, easing } : k)),
				),
		);
	};

	const save = (): void => {
		const input = buildMotionSaveInput(name, layers, initial?.id, durationSec);
		if (!input || busy) return;
		setBusy(true);
		setError(null);
		persistMotionSave(input, saveCompositionTemplate)
			.then(() => {
				onSaved();
				onClose();
			})
			.catch(() => setError("Failed to save motion"))
			.finally(() => setBusy(false));
	};

	const vuiMotionLanes = useMemo(() => buildMotionVuiLanes(layers), [layers]);
	const motionRows = useMemo<MotionTimelineRow[]>(() => {
		const lane = vuiMotionLanes[0];
		if (!lane) return [];
		const rows: MotionTimelineRow[] = [];
		for (const range of lane.ranges) {
			const layerId = Number(range.id.slice("layer-".length));
			const layer = layers.find((item) => item.id === layerId);
			if (!layer) continue;
			rows.push({
				id: range.id,
				label: range.label,
				ranges: [{ ...range, selected: layer.id === selectedId, children: undefined }],
			});
			if (layer.id !== selectedId) continue;
			for (const child of range.children ?? [])
				rows.push({ id: child.id, label: child.label, depth: 1, ranges: [child] });
		}
		return rows;
	}, [layers, selectedId, vuiMotionLanes]);
	/* One scale for the region, and one row height. Held here because the studio
	 * draws its own rows: the library resolves time, and the vertical rhythm of a
	 * layer stack is the consumer's. */
	const motionPxPerSec = 72;
	/* The timeline's gestures, on the library. One surface for the region: layer
	 * bars and keyframes are both hit-tested by identity, so neither owns a
	 * pointer and both survive their row re-rendering mid-drag. */
	const motionTimeline = useMotionTimeline({
		state: useMemo(() => motionStateOf(layers, durationSec), [layers, durationSec]),
		durationSec,
		pxPerSec: motionPxPerSec,
		coarsePointer: compact,
		onSelect: (id, kind) => {
			if (kind === "layer") {
				selectLayerForInspector(Number(id.slice("layer-".length)));
				return;
			}
			const parsed = parseMotionMarkerId(id);
			if (!parsed) return;
			const track = parseMotionTrackRow(`layer-${parsed.layerId}:${parsed.trackId}`);
			if (!track) return;
			setMark(markSelection(parsed.layerId, track, parsed.index));
			setSelectedId(parsed.layerId);
			setIdentityMode(false);
		},
		onMoveLayer: (rowId, startSec) => {
			const layerId = motionLayerIdFromRow(rowId);
			if (layerId === null) return;
			upd(layerId, { start: Math.max(0, startSec) });
		},
		onMoveKeyframe: (markerId, timelineSec) => {
			const parsed = parseMotionMarkerId(markerId);
			const layer = parsed
				? layers.find((candidate) => candidate.id === parsed.layerId)
				: undefined;
			if (!parsed || !layer) return;
			const track = parseMotionTrackRow(`layer-${parsed.layerId}:${parsed.trackId}`);
			if (!track) return;
			moveKeyframeTo(layer, track, parsed.index, timelineSec);
		},
		markerSecondsOf: (markerId) => {
			const parsed = parseMotionMarkerId(markerId);
			const layer = parsed
				? layers.find((candidate) => candidate.id === parsed.layerId)
				: undefined;
			if (!parsed || !layer) return 0;
			const track = parseMotionTrackRow(`layer-${parsed.layerId}:${parsed.trackId}`);
			const keyframes =
				track === null
					? undefined
					: track.kind === "value"
						? layer.anim?.tracks[track.prop]
						: layer.anim?.colorTracks?.[track.prop];
			const keyframe = keyframes?.[parsed.index];
			return keyframe ? layer.start + keyframe.t * layer.dur : layer.start;
		},
	});
	const gutterRef = useRef<HTMLDivElement | null>(null);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const gutterTailRef = useRef<HTMLDivElement | null>(null);
	const attachScroller = useCallback(
		(node: HTMLDivElement | null) => {
			scrollerRef.current = node;
			motionTimeline.scrollerRef(node);
		},
		[motionTimeline.scrollerRef],
	);
	useGutterScrollSync(gutterRef, scrollerRef, gutterTailRef, motionTimeline.scroller !== null);

	/* The view tracks the renderer. Motion Studio's scroller overflows natively
	   once the motion is longer than its width, so following moves that scroller
	   directly — see use-follow-playhead.ts for why the content editor cannot. */
	useFollowPlayhead({
		scroller: motionTimeline.scroller,
		playhead,
		playing,
		pxPerSec: motionPxPerSec,
		gutterSelector: ".vui-timeline-gutter",
		suspended: motionTimeline.gesture !== undefined,
	});

	/** Retime one keyframe to a position on the studio's timeline. */
	const moveKeyframeTo = (
		layer: CompositionLayer,
		track: StudioTrack,
		index: number,
		timelineSec: number,
	): void => {
		moveMark(markSelection(layer.id, track, index), normalizedTimeIn(layer, timelineSec));
	};

	/* The DOCKED rail's destinations: one per layer, plus identity. Unchanged —
	   a rail down the side of a wide panel can hold a list that grows, and
	   picking a layer from it is how the desktop selects one. */
	const railCats: VuiInspectorCategory[] = [
		{ id: "identity", label: "Motion identity", icon: Ic.edit(ICON.md) },
		...layers.map((l) => ({ id: `layer-${l.id}`, label: layerLabel(l), icon: layerIcon(l, 17) })),
	];
	const showIdentity = identityMode || !selected;
	const activeCategory = showIdentity ? "identity" : `layer-${selected!.id}`;
	const selectCategory = (id: string): void => {
		if (id === "identity") {
			setIdentityMode(true);
			setMark(null);
			return;
		}
		selectLayerForInspector(Number(id.slice("layer-".length)));
	};

	/* The BAR's destinations, which are a different question and used to be the
	   same answer.
	 *
	 * The bar listed every layer at once, in both states, so a motion with nine
	 * layers was a nine-glyph strip that had to be searched before it could be
	 * used, and selecting a layer changed nothing about it. It now takes the
	 * content editor's two states: the surface's own destination while nothing is
	 * selected, and the selected layer's sections once something is — which is
	 * what makes the bar's contents a function of what the operator is looking
	 * at, and what keeps it short as a motion grows. */
	const barSubject = showIdentity ? null : layerLabel(selected!);
	const barCats: VuiInspectorCategory[] = showIdentity
		? [
				{
					id: MOTION_IDENTITY_SECTION.k,
					label: MOTION_IDENTITY_SECTION.label,
					icon: MOTION_IDENTITY_SECTION.icon(17),
				},
			]
		: MOTION_LAYER_SECTIONS.map((section) => ({
				id: section.k,
				label: section.label,
				icon: section.icon(17),
			}));
	const barActive = showIdentity ? MOTION_IDENTITY_SECTION.k : openSection;
	const openBarCategory = (id: string): void => {
		if (id === MOTION_IDENTITY_SECTION.k) {
			setIdentityMode(true);
			setMark(null);
			focusSection("identity");
			return;
		}
		/* Narrowed through the list rather than asserted: the bar's categories are
		   built from it, so an id that is not in it is a bug and silently doing
		   nothing is better than opening a section that does not exist. */
		const section = MOTION_LAYER_SECTIONS.find((entry) => entry.k === id);
		if (!section) return;
		focusSection(section.k);
	};

	return (
		<VuiKeyboardScope>
			<VuiEditorWorkspace
				contractVersion={1}
				mode={compact ? "fullscreen" : "modal"}
				label="Motion Studio"
				className="tl2-studio"
				onRequestClose={() => onClose()}
				mobilePanel={{
					open: mobileInspectorOpen,
					title: "Motion inspector",
					onRequestClose: () => setMobileInspectorOpen(false),
				}}
				mobileActions={
					compact ? (
						<StudioActionBar
							subject={barSubject}
							categories={barCats}
							activeCategory={barActive}
							onOpenCategory={(id) => {
								openBarCategory(id);
								setMobileInspectorOpen(true);
							}}
							sheetOpen={mobileInspectorOpen}
							onBack={() => setMobileInspectorOpen(false)}
							onClose={onClose}
							/* Deselecting returns the bar to its tool row, the way the content
						   editor's clip bar returns to the tool rail. */
							onDeselect={() => {
								setIdentityMode(true);
								setMark(null);
							}}
							save={
								<Button
									variant="primary"
									size="sm"
									type="button"
									disabled={!name.trim() || layers.length === 0 || busy}
									onClick={save}
								>
									{busy ? "Saving…" : initial?.id ? "Save changes" : "Save motion"}
								</Button>
							}
						/>
					) : undefined
				}
				/* The same heading component Template Studio uses. It was these exact
					   values written inline here — one duplicate is how two surfaces
					   start disagreeing. */
				headerProvidesClose={compact}
				header={
					<StudioHeading
						title="Motion Studio"
						subtitle="Reusable motion layer, previewed through final video renderer"
						compact={compact}
						onBack={onClose}
					/>
				}
				status={
					error ? (
						<p className="tl2-ct-err" style={{ margin: "0 0 10px" }}>
							{error}
						</p>
					) : undefined
				}
				preview={
					<>
						<VuiPreviewStage className="tl2-studio-stagewrap">
							<div
								className="tl2-studio-stage"
								style={{
									aspectRatio: String(aspect),
									width: `min(100cqw, calc(100cqh * ${aspect}))`,
									background: brand.bgColor,
								}}
							>
								<VuiRemotionPreview
									playerRef={playerRef}
									{...rendererProps}
									loop
									// Silent motion layers must not wait for an audio-device clock.
									initiallyMuted
									style={{ width: "100%", height: "100%" }}
									acknowledgeRemotionLicense
								/>
							</div>
						</VuiPreviewStage>
					</>
				}

				inspector={(() => {
					return (
						<VuiInspectorRail
							categories={railCats}
							active={activeCategory}
							onSelect={selectCategory}
						>
							{showIdentity ? (
								<AccordionSection
									label="Motion identity"
									defaultOpen
									open={compact ? openSection === "identity" : undefined}
									onOpenChange={() => setOpenSection("identity")}
									focusKey={openSection === "identity" ? sectionFocusKey : null}
								>
									<Field>
										<span>Name</span>
										<Input
											type="text"
											placeholder="Motion name"
											maxLength={80}
											value={name}
											onChange={(e) => setName(e.target.value)}
										/>
									</Field>
									<Field>
										<span>Duration (s)</span>
										<Input
											type="number"
											min={1}
											max={30}
											step={0.5}
											value={durationSec}
											onChange={(e) =>
												setDurationSec(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
											}
										/>
									</Field>
								</AccordionSection>
							) : (
								<MotionLayerInspector
									selected={selected!}
									mark={mark}
									progress={progress}
									compact={compact}
									openSection={openSection}
									setOpenSection={setOpenSection}
									sectionFocusKey={sectionFocusKey}
									upd={upd}
									removeLayer={removeLayer}
									setMark={setMark}
									setMarkEasing={setMarkEasing}
									deleteMark={deleteMark}
								/>
							)}
						</VuiInspectorRail>
					);
				})()}
				timelineToolbar={
					<MotionToolbar
						compact={compact}
						addLayer={addLayer}
						playing={playing}
						currentSec={playheadSec}
						durationSec={durationSec}
						onTogglePlay={togglePlay}
						onStop={() => seek(0)}
						onCloseInspector={() => setMobileInspectorOpen(false)}
						inspectorOpen={mobileInspectorOpen}
					/>
				}
				timeline={
					<MotionStudioTimeline
						rows={motionRows}
						layers={layers}
						selectedId={selectedId}
						mark={mark}
						durationSec={durationSec}
						playheadSec={playheadSec}
						pxPerSec={motionPxPerSec}
						projection={motionTimeline.projection}
						gutterRef={gutterRef}
						gutterTailRef={gutterTailRef}
						attachScroller={attachScroller}
						seek={seek}
						removeLayer={removeLayer}
						addMark={addMark}
						moveKeyframeTo={moveKeyframeTo}
					/>
				}
				/* Desktop only: at phone width these two live on the bottom bar. */
				footer={
					compact ? undefined : (
						<div className="cv-modal-actions tl2-studio-actions">
							<Button variant="secondary" size="sm" type="button" onClick={onClose}>
								Cancel
							</Button>
							<Button
								variant="primary"
								size="sm"
								type="button"
								disabled={!name.trim() || layers.length === 0 || busy}
								onClick={save}
							>
								{busy ? "Saving…" : initial?.id ? "Save changes" : "Save motion"}
							</Button>
						</div>
					)
				}
			/>
		</VuiKeyboardScope>
	);
}
