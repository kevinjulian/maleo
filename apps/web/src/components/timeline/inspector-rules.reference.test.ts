/* The inspector's stateless rules against `inspector-rules.reference.json`
 * (`p1-envelope-inspector` design I1). The file was recorded from the
 * TypeScript rules before they moved into `crates/app-core`; this suite holds
 * the web functions to it, and `crates/app-core/tests/inspector_reference.rs`
 * holds the Rust rules to the same file. Regenerate only for a deliberate
 * behavior change, with `MALEO_UPDATE_REFERENCE=1`. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClipKind, ClipLayout } from "@maleo/shared";
import {
	activeClipPropertyGroup,
	clipGroupOptions,
	clipPropertyGroups,
	resolveClipSubject,
} from "./clip-property-groups.tsx";
import {
	dbFromGain,
	faderFromGain,
	formatGainDb,
	gainFromFader,
} from "@models/timeline/audio-fader.ts";
import { defaultTextStyle, normalizeLayout } from "@models/timeline/clip-layout.ts";
import { focalPointAt, nudgeFocalPoint } from "@models/timeline/focal-point.ts";
import type { ClipInspectorKind } from "@models/timeline/timeline-editor-model.ts";

const REFERENCE = join(
	import.meta.dirname,
	"../../../../../packages/shared/src/editor/inspector-reference/inspector-rules.reference.json",
);

const KINDS: ClipKind[] = ["scene", "image", "video", "text"];
const MASK = { shape: "ellipse", xPct: 10, yPct: 10, widthPct: 50, heightPct: 40, featherPct: 5 };
const TRACK = {
	tracks: {
		xPct: [
			{ t: 0, v: 0 },
			{ t: 1, v: 20, easing: "out" },
		],
	},
};
const LAYOUTS: (Partial<ClipLayout> | undefined)[] = [
	undefined,
	{},
	{ opacity: 1.4 },
	{ opacity: -0.2, widthPct: 0, heightPct: 500 },
	{ xPct: -100, yPct: 999, widthPct: 500, heightPct: null as unknown as number },
	{ playbackRate: 0.1, rotationDeg: null as unknown as number, fit: "fill" as ClipLayout["fit"] },
	{ playbackRate: 10, reverse: 1 as unknown as boolean, flipX: "yes" as unknown as boolean },
	{ mask: MASK as ClipLayout["mask"] },
	{ mask: null },
	{ mask: { shape: "hexagon" } as unknown as ClipLayout["mask"] },
	{ color: { brightness: 10, contrast: -20, saturation: 5 } as ClipLayout["color"] },
	{ color: { brightness: "loud" } as unknown as ClipLayout["color"] },
	{ blendMode: "multiply" as ClipLayout["blendMode"] },
	{ blendMode: "sparkle" as unknown as ClipLayout["blendMode"] },
	{ animation: TRACK as ClipLayout["animation"] },
	{ animation: { tracks: { fontSize: [{ t: 0, v: 40 }] } } as ClipLayout["animation"] },
	{ animation: { tracks: { xPct: [{ t: -1, v: 0 }] } } as ClipLayout["animation"] },
	{
		crop: { top: 5, right: 0, bottom: 0, left: 0 } as unknown as ClipLayout["crop"],
		aspectLocked: true,
	},
	{ reverseMedia: { url: "/api/media/x" }, preservePitch: false } as Partial<ClipLayout>,
	{ xPct: 12.345678901234567, yPct: 1 / 3, widthPct: 2.0000000000000004 },
];
const PERCENTS = [-10, 0, 0.5, 1, 12.5, 25, 50, 66.6, 75, 99, 99.9, 100, 120];
const GAINS = [0, -1, 0.000001, 0.003981, 0.01, 0.1, 0.25, 0.5, 0.501187, 0.75, 0.99, 1, 1.5, 4];
const GROUP_KINDS: (ClipInspectorKind | null)[] = [
	null,
	"scene",
	"shape",
	"text",
	"broll",
	"audio",
	"effect",
	"transition",
];
const OPTIONS = [
	undefined,
	{ videoHasAudio: true, brollKind: "video" as const },
	{ brollKind: "image" as const },
	{ sceneHasVideo: true },
];
const SELECTIONS: Parameters<typeof clipGroupOptions>[0][] = [
	{},
	{ videoOverlay: { kind: "video" }, scene: { visualClips: [{ kind: "video" }] } },
	{ videoOverlay: { kind: "image" } },
	{ scene: { visualClips: [{ kind: "image" }, { kind: "video" }] } },
	{ scene: { visualClips: [] } },
];
const SUBJECTS: Parameters<typeof resolveClipSubject>[0][] = [
	{},
	{ videoOverlay: { id: 3, kind: "video", url: "/api/media/a" }, scene: { id: 1, name: "One" } },
	{ videoOverlay: { kind: "image" } },
	{ audio: { id: 2, kind: "music", url: "/api/media/b" }, text: { id: 1 } },
	{ audio: { kind: "voiceover", origin: "generated" } },
	{ text: { id: 4, preset: "plain" } },
	{ text: { id: 5, preset: "shape-circle" } },
	{ effectId: 0, transitionId: 1 },
	{ transitionId: 2 },
	{ scene: { id: 7, name: "Opening" } },
	{ scene: { name: "Unsaved" } },
];

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));
/* JSON has no infinities; the reference names them. */
const number = (value: number): number | string => (Number.isFinite(value) ? value : String(value));

function record() {
	return {
		normalizeLayout: KINDS.flatMap((kind) =>
			LAYOUTS.map((layout) => ({
				kind,
				layout: plain(layout),
				out: plain(normalizeLayout(layout, kind)),
			})),
		),
		defaultTextStyle: [undefined, "plain", "title", "caption"].map((preset) => ({
			preset: preset ?? null,
			out: defaultTextStyle(preset),
		})),
		gainFromFader: PERCENTS.map((pct) => ({ pct, out: gainFromFader(pct) })),
		faderFromGain: GAINS.map((gain) => ({ gain, out: faderFromGain(gain) })),
		dbFromGain: GAINS.map((gain) => ({ gain, out: number(dbFromGain(gain)) })),
		formatGainDb: GAINS.map((gain) => ({ gain, out: formatGainDb(gain) })),
		focalPointAt: [
			[50, 50],
			[0, 0],
			[-20, 300],
			[133.3, 77.7],
			[260, 160],
		].map(([x, y]) => {
			const rect = { left: 10, top: 20, width: 240, height: 135 };
			return { clientX: x, clientY: y, rect, out: focalPointAt(x!, y!, rect) };
		}),
		nudgeFocalPoint: [null, { xPct: 2, yPct: 98 }, { xPct: 50.4, yPct: 0 }].flatMap((point) =>
			["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].map((key) => ({
				point,
				key,
				out: nudgeFocalPoint(point, key),
			})),
		),
		clipPropertyGroups: GROUP_KINDS.flatMap((kind) =>
			OPTIONS.map((opts) => ({
				kind,
				opts: plain(opts),
				out: clipPropertyGroups(kind, opts).map(({ k, label }) => ({ k, label })),
			})),
		),
		activeClipPropertyGroup: GROUP_KINDS.flatMap((kind) =>
			["content", "masks", "levels", "nope", ""].map((remembered) => ({
				kind,
				remembered,
				out: activeClipPropertyGroup(clipPropertyGroups(kind, OPTIONS[1]), remembered),
			})),
		),
		clipGroupOptions: SELECTIONS.map((sel) => ({ sel, out: plain(clipGroupOptions(sel)) })),
		resolveClipSubject: SUBJECTS.map((sel) => ({ sel, out: plain(resolveClipSubject(sel)) })),
	};
}

type Recorded = Record<string, { out: unknown }[]>;

/* Within two units in the last place. JavaScript engines disagree on
 * `Math.log10` by one ULP, so the two display values derived from it cannot be
 * pinned to one engine's bits; `inspector_reference.rs` uses the same rule. The
 * stored gain (`gainFromFader`) is held exactly. */
const NEAR = ["dbFromGain", "faderFromGain"];
const near = (a: unknown, b: unknown): boolean =>
	typeof a === "number" && typeof b === "number"
		? Math.abs(a - b) <= 2 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b))
		: a === b;

describe("inspector rules", () => {
	test("match the recorded reference the Rust rules are held to", () => {
		const actual = plain(record()) as Recorded;
		if (process.env.MALEO_UPDATE_REFERENCE === "1")
			writeFileSync(REFERENCE, `${JSON.stringify(actual, null, "\t")}\n`);
		const expected = JSON.parse(readFileSync(REFERENCE, "utf8")) as Recorded;
		for (const name of NEAR)
			actual[name]!.forEach((entry, index) => {
				const recorded = expected[name]![index]!.out;
				if (near(entry.out, recorded)) entry.out = recorded;
			});
		expect(actual).toEqual(expected);
	});
});
