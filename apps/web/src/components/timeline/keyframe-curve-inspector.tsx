import { useState } from "react";
import {
	CLIP_ANIMATION_EASINGS,
	applyKeyframeEasing,
	NUMERIC_ANIMATION_PROPERTY_NAMES,
	COLOR_ANIMATION_PROPERTY_NAMES,
	type KeyframeEasing,
} from "@maleo/shared";
import {
	clipAnimationInfo,
	setMomentsEasing,
	type ClipAnimationTarget,
} from "@models/timeline/clip-animation-edit.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { Note } from "@design-system/components/note.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";

const LABELS: Record<KeyframeEasing, string> = {
	linear: "Linear",
	in: "Ease in",
	out: "Ease out",
	"in-out": "Ease in/out",
	bezier: "Custom curve",
	hold: "Hold",
};

/** Curves belong to selected keys, alongside their property values in the inspector. */
export function KeyframeCurveInspector({
	target,
	store,
	chromeStore,
	writers,
}: {
	target: ClipAnimationTarget | undefined;
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
	writers: DocumentWriters;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [selected] = useChromeField(chromeStore, "clipKeySelection");
	const [error, setError] = useState<string | null>(null);
	const info = target && clipAnimationInfo(doc, target);
	if (!info || !selected || selected.target !== JSON.stringify(target)) return null;
	const at = (t: number) => selected.times.some((m) => Math.abs(m - t) <= 1 / 60 + 1e-9);
	const keys = [
		...NUMERIC_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			!selected.property || selected.property === p
				? (info.animation?.tracks[p]?.filter((k) => at(k.t)) ?? [])
				: [],
		),
		...COLOR_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			!selected.property ? (info.animation?.colorTracks?.[p]?.filter((k) => at(k.t)) ?? []) : [],
		),
	];
	if (!keys.length) return null;
	const easings = new Set(keys.map((k) => k.easing ?? "linear")),
		easing = easings.size === 1 ? (keys[0]!.easing ?? "linear") : "mixed";
	const path =
		easing === "mixed" || easing === "bezier"
			? ""
			: Array.from(
					{ length: 41 },
					(_, i) =>
						`${i ? "L" : "M"}${10 + i * 2},${60 - applyKeyframeEasing(easing, i / 40) * 50}`,
				).join(" ");
	return (
		<InspectorSection title="Curve">
			<PropertyRow label="Easing">
				<Select
					aria-label="Keyframe easing"
					size="xs"
					value={easing}
					disabled={info.locked}
					onValueChange={onSelect(CLIP_ANIMATION_EASINGS, (value) => {
						try {
							writers.apply((scope) =>
								setMomentsEasing(scope, target!, selected.times, value, selected.property),
							);
							setError(null);
						} catch (failure) {
							setError(failure instanceof Error ? failure.message : "Easing failed");
						}
					})}
					phoneBreakpoint={860}
					options={[
						...(easing === "mixed" ? [{ value: "mixed", label: "Mixed", disabled: true }] : []),
						...(easing === "bezier"
							? [{ value: "bezier", label: "Custom curve", disabled: true }]
							: []),
						...(CLIP_ANIMATION_EASINGS.map((value) => ({ value: value, label: LABELS[value] })) ??
							[]),
					]}
				/>
			</PropertyRow>
			{path && (
				<svg
					className="tl2-key-curve"
					viewBox="0 0 100 70"
					role="img"
					aria-label={`${easing === "mixed" ? "Mixed" : LABELS[easing]} easing curve`}
				>
					<path className="tl2-key-curve-axis" d="M10 10v50h80" />
					<path d={path} />
				</svg>
			)}
			{error && <Note tone="error">{error}</Note>}
		</InspectorSection>
	);
}
