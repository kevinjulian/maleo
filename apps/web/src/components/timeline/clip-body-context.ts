/* What a clip kind's property body reads: the inspector's own props plus what
 * TimelineClipInspector derives once per render — the active group, the live
 * document, the key controls, and the section wrappers every kind shares. One
 * value, so a body's signature does not restate the stage's two bags. */
import type { JSX } from "react";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { CompositingPart } from "./clip-compositing-control.tsx";
import type { ClipPropertyGroupKey } from "./clip-property-groups.tsx";
import type { useClipKeying } from "./keyed-property-row.tsx";
import type { TimelineClipInspectorProps } from "./timeline-clip-inspector.tsx";

type ClipKeying = ReturnType<typeof useClipKeying>;
type CompositingTarget = { source: "scene" | "video"; id: number };

export interface ClipBodyContext extends TimelineClipInspectorProps {
	tab: ClipPropertyGroupKey;
	liveDoc: ReturnType<TimelineDocumentStore["getDoc"]>;
	keying: ClipKeying["keying"];
	rowKeying: ClipKeying["rowKeying"];
	keyError: ClipKeying["error"];
	totalSec: number;
	transform: (section: JSX.Element) => JSX.Element;
	compositing: (target: CompositingTarget, parts: readonly CompositingPart[]) => JSX.Element;
	blendMode: (target: CompositingTarget) => JSX.Element;
	editHost: (target: { type: "scene" | "broll" | "audio" | "text"; id: number }) => JSX.Element;
}
