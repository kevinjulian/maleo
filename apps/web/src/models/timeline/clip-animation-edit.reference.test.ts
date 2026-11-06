/* The animation edits against `inspector-reference/clip-animation-edit.reference.json`
 * (`p1-envelope-inspector` task 3.4). Recorded from the TypeScript rules before
 * they moved into `crates/app-core`; this suite holds the web functions to it,
 * and `crates/app-core/tests/inspector_reference.rs` holds the Rust rules to it.
 * Regenerate only for a deliberate behavior change, with `MALEO_UPDATE_REFERENCE=1`. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { edgeAnimationState, type NumericAnimationProperty } from "@maleo/shared";
import type { EditScope } from "@maleo/shared/editor";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import {
	animationTargetForId,
	applyEdgePreset,
	clipAnimationInfo,
	clipIdForTarget,
	editClipKey,
	keyMoments,
	momentKeyEasings,
	moveClipKey,
	moveMoment,
	moveMoments,
	pasteClipKeys,
	removeClipKey,
	rowKeyingAt,
	selectedClipAnimationTarget,
	setMomentsEasing,
	type ClipAnimationTarget,
} from "./clip-animation-edit.ts";
import type { Selection } from "./selection-model.ts";

const EDITOR = join(import.meta.dirname, "../../../../../packages/shared/src/editor");
const REFERENCE = join(EDITOR, "inspector-reference", "clip-animation-edit.reference.json");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

/* The key-rule reference's scopes: files it names and the scopes it generated. */
function scopes(): { name: string; scope: EditScope }[] {
	const keys = readJson(join(EDITOR, "inspector-reference", "clip-keys.reference.json")) as {
		generated: Record<string, EditScope>;
		targets: { scope: string }[];
	};
	/* Distinct shapes only: the `clip.setKeys` fixtures share one base scope. */
	const names = [...new Set(keys.targets.map((target) => target.scope))].filter((name) =>
		KEPT.some((kept) => name === kept),
	);
	return names.map((name) => {
		const generated = keys.generated[name];
		if (generated) return { name, scope: generated };
		const [dir, file] = name.split("/") as [string, string];
		const value = readJson(
			dir === "corpus" ? join(EDITOR, "corpus/scopes", file) : join(EDITOR, "fixtures", dir, file),
		) as { scope?: EditScope };
		return { name, scope: (dir === "corpus" ? value : value.scope) as EditScope };
	});
}

const KEPT = [
	"synthetic",
	"synthetic-locked",
	"clip.setKeys/set.json",
	"clip.setKeys/text-colour.json",
	"corpus/video-s-0e71d5854634.json",
	"corpus/video-s-4832bcb58fca.json",
];

/** A thrown refusal as data, so the reference records it. */
function attempt(build: () => unknown): unknown {
	try {
		return { ok: plain(build()) };
	} catch (failure) {
		return { error: failure instanceof Error ? failure.message : String(failure) };
	}
}

const EMPTY: Selection = {
	sceneId: null,
	overlayId: null,
	audioId: null,
	videoOverlayId: null,
	effectId: null,
	transitionId: null,
	freeIds: [],
} as unknown as Selection;

const ROWS: NumericAnimationProperty[][] = [
	["xPct", "yPct"],
	["opacity"],
	["volume"],
	["fontSize"],
	["scale", "rotationDeg"],
];

function targetCases(scope: EditScope, target: ClipAnimationTarget) {
	const doc = scope.doc as EditorDoc;
	const info = clipAnimationInfo(doc, target);
	const out: Record<string, unknown> = {
		target,
		clipId: clipIdForTarget(doc, target),
		info: plain(info),
	};
	if (!info) return out;
	const d = info.duration;
	const properties = [...new Set([...info.properties, "volume" as const])];
	out.edit = properties.flatMap((property) =>
		[-0.1, 0.05, d / 2, d + 0.1].flatMap((time) =>
			[
				[undefined, undefined],
				[0.3, "in" as const],
			].map(([value, easing]) =>
				attempt(() =>
					editClipKey(
						scope,
						target,
						property,
						time,
						value as number | undefined,
						easing as "in" | undefined,
					),
				),
			),
		),
	);
	const keyed = info.properties.filter((p) => info.animation?.tracks[p]?.length);
	out.remove = keyed.flatMap((p) =>
		[0, 99].map((index) => attempt(() => removeClipKey(scope, target, p, index))),
	);
	out.move = keyed.flatMap((p) =>
		[0.2, -1, d].map((time) => attempt(() => moveClipKey(scope, target, p, 0, time))),
	);
	const moments = keyMoments(info.animation);
	out.moments = plain(moments);
	const times = moments.map((m) => m.time);
	out.moveMoments = [times, times.slice(0, 1), []].flatMap((selected) =>
		[undefined, 0.25, -100, 100].map((delta) =>
			attempt(() => moveMoments(scope, target, selected, delta)),
		),
	);
	out.moveMoment = [undefined, 0.4, -1, d + 1].map((to) =>
		attempt(() => moveMoment(scope, target, times[0] ?? 0, to)),
	);
	out.easing = [undefined, keyed[0], "fill" as const].map((property) =>
		attempt(() => setMomentsEasing(scope, target, times, "hold", property)),
	);
	out.momentEasings = times.map((time) => momentKeyEasings(info.animation, time));
	out.edge = (["in", "out"] as const).flatMap((edge) =>
		(["none", "fade", "slide", "zoom"] as const).flatMap((preset) =>
			// Zero seconds is refused before anything else; one case covers it.
			[0.5, d * 2].map((seconds) =>
				attempt(() => applyEdgePreset(scope, target, edge, preset, seconds)),
			),
		),
	);
	out.edgeZero = attempt(() => applyEdgePreset(scope, target, "in", "fade", 0));
	out.edgeState = (["in", "out"] as const).map((edge) =>
		edgeAnimationState(info.animation, edge, d, info.values, info.audio),
	);
	out.rows = ROWS.flatMap((properties) =>
		[info.start - 1, info.start, info.start + d / 3, info.start + d].map((absolute) => {
			const row = rowKeyingAt(doc, target, properties, absolute, 30);
			if (!row) return null;
			const { toggle, set, ...state } = row;
			return {
				...(plain(state) as object),
				toggle: attempt(() => toggle(scope)),
				set: attempt(() => set(scope, { [properties[0]!]: 12 })),
			};
		}),
	);
	return out;
}

function record() {
	const cases: unknown[] = [];
	const selections: unknown[] = [];
	for (const { name, scope } of scopes()) {
		const doc = scope.doc as EditorDoc;
		/* At most two targets per kind and animated-or-static: every branch, a bounded file. */
		const seen = new Map<string, number>();
		const targets = doc.clips.flatMap((clip) => {
			const target = animationTargetForId(doc, clip.id);
			if (!target) return [];
			const info = clipAnimationInfo(doc, target);
			const shape = `${info?.kind}:${Boolean(info && keyMoments(info.animation).length)}`;
			const count = seen.get(shape) ?? 0;
			if (count >= 2) return [];
			seen.set(shape, count + 1);
			return [{ id: clip.id, target }];
		});
		for (const { id, target } of targets)
			cases.push({ scope: name, id, ...targetCases(scope, target) });
		// Each clip pasted onto every target: the first keyed clip is the clipboard.
		const clipboard = targets
			.map(({ target }) => clipAnimationInfo(doc, target)?.animation)
			.find((animation) => animation && keyMoments(animation).length);
		if (clipboard)
			for (const { id, target } of targets)
				cases.push({
					scope: name,
					id,
					paste: attempt(() => pasteClipKeys(scope, target, clipboard)),
				});
		for (const clip of doc.clips) {
			const [source, rawId] = clip.id.split(":") as [string, string];
			const numeric = Number(rawId);
			const selection = {
				...EMPTY,
				...(source === "video" ? { videoOverlayId: numeric } : {}),
				...(source === "audio" ? { audioId: numeric } : {}),
				...(source === "text" ? { overlayId: numeric } : {}),
				...(source === "scene" ? { sceneId: numeric } : {}),
			} as Selection;
			for (const choice of [null, { sceneId: numeric, visualId: "missing" }])
				selections.push({
					scope: name,
					selection: plain(selection),
					choice,
					out: plain(selectedClipAnimationTarget(doc, selection, choice)),
				});
		}
	}
	return { cases, selections };
}

describe("animation edits", () => {
	test("match the recorded reference the Rust rules are held to", () => {
		const actual = plain(record());
		if (process.env.MALEO_UPDATE_REFERENCE === "1")
			writeFileSync(REFERENCE, `${JSON.stringify(actual)}\n`);
		expect(actual).toEqual(readJson(REFERENCE));
	});
});
