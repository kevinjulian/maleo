import { Callout } from "@design-system/components/note.tsx";
import { isCommitEnter } from "@models/core/keys.ts";
/* Keyframe motion editor. Lets the user author a per-clip camera motion:
 * drag keyframes on a normalized (0..1) track, tune each frame's transform, and
 * scrub a live preview that samples the SAME evalMotion the renderer uses.
 *
 * Motion is an optional per-clip override. When absent the clip falls back to
 * its named `move` preset; "Customize" seeds an editable copy of that preset and
 * "Reset" clears it back to the preset. */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { evalMotion } from "@maleo/video/composition";
import type { MotionPreset, CustomMotion, MotionEasing } from "@maleo/shared";
import {
	addKeyframe,
	moveKeyframe,
	MOTION_EASINGS,
	removeKeyframe,
	seedMotion,
	updateKeyframe,
} from "@models/timeline/motion-editor-model.ts";
import {
	createMotionPreset,
	deleteMotionPreset,
	listMotionPresets,
	updateMotionPreset,
} from "@api/templates.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { Input } from "@design-system/components/input.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { Slider } from "@design-system/components/slider.tsx";
import { PropertyRow } from "@design-system/patterns/inspector.tsx";

interface MotionEditorProps {
	/** Named preset the clip currently uses (seed source when customizing). */
	move: string;
	/** Current custom motion, or null/undefined when using the preset. */
	motion?: CustomMotion | null;
	/** Clip start-frame image for the preview. */
	src?: string;
	/** Preview aspect ratio (width / height). */
	aspect: number;
	onChange: (motion: CustomMotion | null) => void;
	showPresetLibrary?: boolean;
}

const EASING_LABEL = {
	linear: "Linear",
	in: "Ease in",
	out: "Ease out",
	"in-out": "Ease in-out",
	bezier: "Expo",
} satisfies Record<MotionEasing, string>;

export function MotionEditor({
	move,
	motion,
	src,
	aspect,
	onChange,
	showPresetLibrary = true,
}: MotionEditorProps): JSX.Element {
	const [selected, setSelected] = useState(0);
	const [scrub, setScrub] = useState(0);
	const [presets, setPresets] = useState<MotionPreset[]>([]);
	const [saveName, setSaveName] = useState("");
	const [saving, setSaving] = useState(false);
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<number | null>(null);

	const refreshPresets = useCallback(() => {
		listMotionPresets()
			.then(setPresets)
			.catch(() => {
				/* non-fatal: presets stay as-is */
			});
	}, []);
	useEffect(() => {
		refreshPresets();
	}, [refreshPresets]);

	const applyPreset = (preset: MotionPreset): void => {
		onChange({ keyframes: preset.keyframes.map((k) => ({ ...k })) });
		setSelected(0);
	};

	const removePreset = (id: string): void => {
		deleteMotionPreset(id)
			.then(refreshPresets)
			.catch(() => {
				/* non-fatal */
			});
	};

	const presetList =
		showPresetLibrary && presets.length > 0 ? (
			<div className="tl2-motion-presets">
				<span className="tl2-motion-presets-h">Saved presets</span>
				{presets.map((preset) => (
					<div key={preset.id} className="tl2-motion-preset-row">
						<Button type="button" size="sm" variant="ghost" onClick={() => applyPreset(preset)}>
							{preset.name}
						</Button>
						<button
							type="button"
							className="tl2-motion-preset-del"
							title="Delete preset"
							aria-label={`Delete ${preset.name}`}
							onClick={() => removePreset(preset.id)}
						>
							×
						</button>
					</div>
				))}
			</div>
		) : null;

	if (!motion) {
		return (
			<div className="tl2-motion-empty">
				<span>
					Custom keyframe motion overrides the <b>{move || "preset"}</b> movement.
				</span>
				<Button
					type="button"
					size="sm"
					onClick={() => {
						onChange(seedMotion(move));
						setSelected(0);
					}}
				>
					Customize motion
				</Button>
				{presetList}
			</div>
		);
	}

	const saveAsPreset = (): void => {
		const name = saveName.trim();
		if (!name || saving) return;
		setSaving(true);
		createMotionPreset({ name, keyframes: motion.keyframes.map((k) => ({ ...k })) })
			.then(() => {
				setSaveName("");
				refreshPresets();
			})
			.catch(() => {
				/* non-fatal */
			})
			.finally(() => setSaving(false));
	};

	const kfs = motion.keyframes;
	const sel = kfs[Math.min(selected, kfs.length - 1)];
	const selIndex = Math.min(selected, kfs.length - 1);
	const sample = evalMotion(motion, scrub);

	const tFromClientX = (clientX: number): number => {
		const el = trackRef.current;
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	};

	/* A plain function, not a hook: this sits below the `!motion` early return,
	 * so as `useCallback` it ran only once motion existed and React threw
	 * "Rendered more hooks than during the previous render" the moment
	 * Customize motion was pressed. It reads only refs and a setter. */
	const onDotDown =
		(index: number) =>
		(e: React.PointerEvent): void => {
			e.stopPropagation();
			e.currentTarget.setPointerCapture(e.pointerId);
			dragRef.current = index;
			setSelected(index);
		};

	const onTrackPointerMove = (e: React.PointerEvent): void => {
		if (dragRef.current == null) return;
		const t = tFromClientX(e.clientX);
		const res = moveKeyframe(motion, dragRef.current, t);
		onChange(res.motion);
	};

	const onTrackPointerUp = (): void => {
		dragRef.current = null;
	};

	const onTrackClick = (e: React.PointerEvent): void => {
		if (dragRef.current != null) return;
		const t = tFromClientX(e.clientX);
		setScrub(t);
	};

	/* Takes a MouseEvent, not a PointerEvent: it reads `clientX` and nothing
	 * else, and a double-click is a MouseEvent. The narrower parameter was what
	 * forced the caller to assert. */
	const onTrackDoubleClick = (e: React.MouseEvent): void => {
		const t = tFromClientX(e.clientX);
		const res = addKeyframe(motion, t);
		onChange(res.motion);
		setSelected(res.index);
	};

	/* NumberField only reports finite numbers, so there is nothing to parse. */
	const patchNum =
		(field: "scale" | "x" | "y" | "rotate") =>
		(value: number): void => {
			onChange(updateKeyframe(motion, selIndex, { [field]: value }));
		};

	const isEndpoint = selIndex === 0 || selIndex === kfs.length - 1;

	return (
		<div className="tl2-motion">
			<div className="tl2-motion-preview" style={{ aspectRatio: String(aspect) }}>
				{src ? (
					<img
						src={src}
						alt=""
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
							scale: String(sample.scale),
							translate: `${sample.x}px ${sample.y}px`,
							rotate: sample.rotate ? `${sample.rotate}deg` : undefined,
							transformOrigin: "center",
						}}
					/>
				) : (
					<div className="tl2-motion-noimg">No frame image</div>
				)}
			</div>

			<Slider
				className="tl2-motion-scrub"
				min={0}
				max={1}
				step={0.01}
				value={scrub}
				onChange={(e) => setScrub(Number(e.target.value))}
				aria-label="Scrub preview"
			/>

			<div
				ref={trackRef}
				className="tl2-motion-track"
				onPointerMove={onTrackPointerMove}
				onPointerUp={onTrackPointerUp}
				onPointerDown={onTrackClick}
				onDoubleClick={onTrackDoubleClick}
			>
				<div className="tl2-motion-playhead" style={{ left: `${scrub * 100}%` }} />
				{kfs.map((k, i) => (
					<button
						key={i}
						type="button"
						className={`tl2-motion-dot${i === selIndex ? " is-sel" : ""}`}
						style={{ left: `${k.t * 100}%` }}
						onPointerDown={onDotDown(i)}
						title={`t=${k.t.toFixed(2)}`}
						aria-label={`Keyframe ${i + 1}`}
					/>
				))}
			</div>

			<div className="tl2-motion-insp">
				<div className="tl2-motion-insp-h">
					<span>
						Keyframe {selIndex + 1} / {kfs.length}
						{isEndpoint ? " (endpoint)" : ""}
					</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={kfs.length <= 2 || isEndpoint}
						onClick={() => {
							onChange(removeKeyframe(motion, selIndex));
							setSelected(Math.max(0, selIndex - 1));
						}}
					>
						Delete
					</Button>
				</div>
				<PropertyRow label="Position" as="div">
					<NumberField
						icon="X"
						aria-label="X"
						step={1}
						value={sel.x}
						onValueChange={patchNum("x")}
					/>
					<NumberField
						icon="Y"
						aria-label="Y"
						step={1}
						value={sel.y}
						onValueChange={patchNum("y")}
					/>
				</PropertyRow>
				<PropertyRow label="Scale">
					<NumberField step={0.01} value={sel.scale} onValueChange={patchNum("scale")} />
				</PropertyRow>
				<PropertyRow label="Rotation">
					<NumberField
						suffix="°"
						step={1}
						value={sel.rotate ?? 0}
						onValueChange={patchNum("rotate")}
					/>
				</PropertyRow>
				<PropertyRow label="Easing">
					<Select
						size="xs"
						value={sel.easing ?? "linear"}
						disabled={selIndex === 0}
						title={selIndex === 0 ? "Unused on the first keyframe" : undefined}
						onValueChange={onSelect(MOTION_EASINGS, (easing) =>
							onChange(updateKeyframe(motion, selIndex, { easing })),
						)}
						aria-label={"Easing"}
						phoneBreakpoint={860}
						options={[
							...(MOTION_EASINGS.map((id) => ({ value: id, label: EASING_LABEL[id] })) ?? []),
						]}
					/>
				</PropertyRow>
			</div>

			<div className="tl2-motion-save">
				<Input
					type="text"
					placeholder="Preset name"
					maxLength={80}
					value={saveName}
					onChange={(e) => setSaveName(e.target.value)}
					onKeyDown={(e) => {
						if (isCommitEnter(e)) saveAsPreset();
					}}
				/>
				<Button
					type="button"
					size="sm"
					disabled={!saveName.trim() || saving}
					onClick={saveAsPreset}
				>
					Save as preset
				</Button>
			</div>

			{presetList}

			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="tl2-motion-reset"
				onClick={() => onChange(null)}
			>
				Reset to {move || "preset"}
			</Button>
		</div>
	);
}

export function MotionPresetLibraryBlock({
	query = "",
	onCount,
}: {
	query?: string;
	onCount?: (count: number) => void;
}): JSX.Element {
	const [presets, setPresets] = useState<MotionPreset[]>([]);
	const [editing, setEditing] = useState<{
		preset: MotionPreset | null;
		name: string;
		motion: CustomMotion;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		listMotionPresets()
			.then((items) => {
				setPresets(items);
				onCount?.(items.length);
				setError(null);
			})
			.catch(() => setError("Failed to load motion presets"));
	}, [onCount]);
	useEffect(() => {
		refresh();
	}, [refresh]);

	const q = query.trim().toLowerCase();
	const visible = q ? presets.filter((preset) => preset.name.toLowerCase().includes(q)) : presets;
	const openPreset = (preset: MotionPreset): void => {
		setEditing({
			preset,
			name: preset.name,
			motion: { keyframes: preset.keyframes.map((keyframe) => ({ ...keyframe })) },
		});
	};

	const save = async (): Promise<void> => {
		if (!editing || !editing.name.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			const input = {
				name: editing.name.trim(),
				keyframes: editing.motion.keyframes.map((keyframe) => ({ ...keyframe })),
			};
			if (editing.preset) await updateMotionPreset(editing.preset.id, input);
			else await createMotionPreset(input);
			setEditing(null);
			refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			await deleteMotionPreset(id);
			refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (editing) {
		return (
			<div className="tl2-motion-library-edit">
				<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
					<button type="button" className="cv-ghostbtn sm" onClick={() => setEditing(null)}>
						Back
					</button>
					<Input
						value={editing.name}
						placeholder="Motion preset name"
						onChange={(event) =>
							setEditing((current) =>
								current ? { ...current, name: event.target.value } : current,
							)
						}
					/>
					<button
						type="button"
						className="cv-ghostbtn sm"
						disabled={busy || !editing.name.trim()}
						onClick={() => void save()}
					>
						{busy ? "Saving..." : "Save"}
					</button>
				</div>
				<MotionEditor
					move={editing.name || "motion preset"}
					motion={editing.motion}
					aspect={16 / 9}
					showPresetLibrary={false}
					onChange={(motion) =>
						setEditing((current) =>
							current ? { ...current, motion: motion ?? current.motion } : current,
						)
					}
				/>
				{error && <Callout role="status">{error}</Callout>}
			</div>
		);
	}

	return (
		<div className="tl2-motion-library-list">
			<button
				type="button"
				className="cv-addtile"
				onClick={() => setEditing({ preset: null, name: "", motion: seedMotion("zoom-in") })}
			>
				New motion preset
			</button>
			{error && <Callout role="status">{error}</Callout>}
			{visible.length === 0 ? (
				<p className="cv-cat-empty">
					{presets.length === 0 ? "No motion presets yet." : "No motion presets match this search."}
				</p>
			) : (
				<div className="tl2-motion-presets">
					{visible.map((preset) => (
						<div key={preset.id} className="tl2-motion-preset-row">
							<Button type="button" size="sm" variant="ghost" onClick={() => openPreset(preset)}>
								{preset.name}
							</Button>
							<button
								type="button"
								className="tl2-motion-preset-del"
								title="Delete preset"
								aria-label={`Delete ${preset.name}`}
								disabled={busy}
								onClick={() => void remove(preset.id)}
							>
								×
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
