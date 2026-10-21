/* TEST SUPPORT ONLY. The cross-runtime parity check for the Rust engine
 * (`migrate-editor-to-shared-rust-core`, tasks 2.3/2.4).
 *
 * One case list runs through the native build (`crates/editor-wasm/src/bin/
 * parity.rs`), the WASM build in a browser and the WASM build in Bun, and every
 * result must be identical: the same scope text, inverse text, error kind and
 * message, and tick values. No IO here, so the runner can be bundled into a
 * browser page; callers load the fixtures and corpus. */
import type { Engine, EngineResult } from "./engine.ts";
import type { EditorCommand } from "./commands.ts";
import type { Clip } from "../timeline-doc.ts";
import type { EditScope } from "./scope.ts";

export type ParityCase =
	| { kind: "once"; scope: string; command: string }
	| { kind: "sequence"; scope: string; commands: string[] }
	| { kind: "ticks"; seconds: number[] };

export type Outcome = { ok: string } | { error: string };
export type ParityResult =
	| Outcome
	| { open: { error: string } }
	| { steps: Outcome[]; final: Outcome; closed: boolean; open: number }
	| { ticks: (number | null)[] };

export const TICK_SAMPLES: readonly number[] = [
	0,
	0.1,
	1 / 3,
	0.5 / 30000,
	-0.5 / 30000,
	2.5,
	33.36666666666667,
	1e300,
	-1e300,
	36000,
];

/* SAFETY: these values sit outside the TS types on purpose — an extra field in
 * a patch, `null` for an optional field, a partial marker — because the wire
 * contract admits them and both executors must treat them identically. This is
 * the one place a generated edit leaves the type, so it is named. */
const offContract = <T>(value: unknown): T => value as T;

const edits = (clip: Clip): EditorCommand[] => {
	const middle = clip.startSec + clip.durationSec / 2;
	return [
		{ type: "clip.move", id: clip.id, patch: { startSec: clip.startSec + 0.5 } },
		{ type: "clip.trim-before", id: clip.id, at: middle },
		{ type: "clip.trim-after", id: clip.id, at: middle },
		{ type: "clip.replace", id: clip.id, clip },
		{
			type: "clip.update",
			id: clip.id,
			patch: offContract<Partial<Clip>>({
				durationSec: clip.durationSec + 0.25,
				generatedField: "added by the edit",
			}),
		},
		{ type: "clip.remove", id: clip.id },
		{
			type: "clip.setKeys",
			id: clip.id,
			property: "opacity",
			keys: [
				{ t: 0, v: 0 },
				{ t: clip.durationSec / 2, v: 1, easing: "in" },
			],
		},
		{ type: "clip.setKeys", id: clip.id, property: "opacity", keys: [] },
		{ type: "clip.setKeys", id: clip.id, property: "opacity", keys: [{ t: 0, v: 5 }] },
		{ type: "clip.setKeys", id: clip.id, property: "fill", keys: [{ t: 0, v: "#fff" }] },
		{ type: "clip.setKeys", id: clip.id, property: "volume", keys: [{ t: 0, v: 0.5 }] },
		{
			type: "clip.setKeys",
			id: clip.id,
			property: "scale",
			keys: [{ t: clip.durationSec * 2, v: 1 }],
		},
		{ type: "clip.resize", id: clip.id, durationSec: clip.durationSec / 2 },
		{ type: "clip.resize", id: clip.id, durationSec: clip.durationSec * 3 },
		{
			type: "clip.resize",
			id: clip.id,
			durationSec: clip.durationSec,
			startSec: clip.startSec - 1,
		},
		{
			type: "clip.resize",
			id: clip.id,
			durationSec: clip.durationSec / 3,
			startSec: clip.startSec + clip.durationSec / 3,
		},
		{ type: "clip.insert", clip: { ...clip, id: `${clip.id}:copy` }, index: 1 },
		{
			type: "batch",
			label: "generated",
			commands: [
				{ type: "clip.move", id: clip.id, patch: { startSec: clip.startSec + 0.5 } },
				{ type: "clip.trim-after", id: clip.id, at: middle + 0.5 },
			],
		},
	];
};

/* Edits of every executed type against one scope: each clip's edits, each
 * marker updated, removed and re-upserted, and the document-field, media, list
 * and whole-scope commands, including absent-versus-null field values. */
export function generatedEdits(scope: EditScope): EditorCommand[] {
	const commands: EditorCommand[] = scope.doc.clips.flatMap(edits);
	scope.doc.markers.forEach((marker, index) => {
		commands.push({
			type: "marker.update",
			id: marker.id,
			patch: offContract({ generatedField: index }),
		});
		commands.push({ type: "marker.remove", id: marker.id });
		commands.push({ type: "marker.upsert", marker });
	});
	commands.push(
		{ type: "marker.upsert", marker: offContract({ id: 987654, time: 1.5 }), index: 0 },
		{ type: "bookmark.set" },
		{ type: "bookmark.set", bookmarks: [{ id: "generated", timeSec: 1, label: "Generated" }] },
		{ type: "bookmark.upsert", bookmark: { id: "generated", timeSec: 2, label: "  Generated  " } },
		{ type: "bookmark.upsert", bookmark: { id: "upserted", timeSec: 3, label: "New" } },
		{ type: "bookmark.upsert", bookmark: { id: "invalid", timeSec: -1, label: "x" } },
		{ type: "bookmark.remove", id: "generated" },
		{ type: "doc.setCaptions" },
		{ type: "doc.setCaptions", captions: offContract(null) },
		{ type: "doc.setProjectReferences" },
		{ type: "doc.setMaterials", materials: offContract({}) },
		{ type: "doc.setTrackFlags", trackFlags: offContract({ 0: { locked: true } }) },
		{ type: "media.update", mediaAssets: [] },
		{
			type: "media.admit",
			asset: offContract({ id: "generated", url: "/uploads/generated.png", kind: "image" }),
		},
		{ type: "scope.replace", scope },
		{ type: "noop" },
	);
	const bookmark = scope.doc.bookmarks?.[0];
	if (bookmark) commands.push({ type: "bookmark.remove", id: bookmark.id });
	const asset = scope.mediaAssets[0];
	if (asset) commands.push({ type: "media.admit", asset });
	scope.slides.forEach((slide, index) => {
		commands.push(
			{ type: "slide.update", id: slide.id, patch: offContract({ generatedField: index }) },
			{ type: "slide.remove", id: slide.id },
			{ type: "slide.insert", slide: { ...slide, id: 987654 }, index: 0 },
		);
	});
	scope.posts.forEach((post, index) => {
		commands.push(
			{ type: "post.update", id: post.id, patch: offContract({ generatedField: index }) },
			{ type: "post.remove", id: post.id },
			{ type: "post.insert", post: { ...post, id: 987654 }, index: 0 },
		);
	});
	return commands;
}

/* Every golden fixture's command against its scope (executed types must match
 * exactly; the rest must be refused identically), every generated edit of every
 * corpus scope, a handle sequence per corpus scope that mixes edits with
 * refusals, and the inputs every runtime must refuse the same way. */
export function buildParityCases(
	fixtures: readonly { scope: EditScope; command: EditorCommand }[],
	corpus: readonly EditScope[],
): ParityCase[] {
	const cases: ParityCase[] = fixtures.map((fixture) => ({
		kind: "once",
		scope: JSON.stringify(fixture.scope),
		command: JSON.stringify(fixture.command),
	}));
	for (const scope of corpus) {
		const text = JSON.stringify(scope);
		for (const command of generatedEdits(scope))
			cases.push({ kind: "once", scope: text, command: JSON.stringify(command) });
		const [first, second] = scope.doc.clips;
		if (!first) continue;
		cases.push({
			kind: "sequence",
			scope: text,
			commands: [
				...edits(first)
					.slice(0, 3)
					.map((command) => JSON.stringify(command)),
				JSON.stringify({
					type: "clip.setKeys",
					id: first.id,
					property: "opacity",
					keys: [],
					ripple: true,
				}),
				JSON.stringify({ type: "clip.teleport", id: first.id }),
				JSON.stringify({ type: "clip.move", id: first.id, patch: { startSec: 1 }, ripple: true }),
				...(second ? [JSON.stringify(edits(second)[0])] : []),
				JSON.stringify({ type: "noop" }),
			],
		});
	}
	const sample = corpus[0] ?? fixtures[0]?.scope;
	if (sample) {
		const text = JSON.stringify(sample);
		cases.push({
			kind: "once",
			scope: JSON.stringify({ ...sample, doc: { ...sample.doc, schemaVersion: 3 } }),
			command: '{"type":"noop"}',
		});
		cases.push({ kind: "once", scope: "{not json", command: '{"type":"noop"}' });
		cases.push({ kind: "once", scope: text, command: "[]" });
		cases.push({
			kind: "sequence",
			scope: JSON.stringify({ ...sample, doc: { ...sample.doc, schemaVersion: 1 } }),
			commands: ['{"type":"noop"}'],
		});
	}
	cases.push({ kind: "ticks", seconds: [...TICK_SAMPLES] });
	return cases;
}

const outcome = (result: EngineResult<string>): Outcome =>
	result.ok
		? { ok: result.value }
		: { error: JSON.stringify({ kind: result.error.kind, message: result.error.message }) };

/* The same result shape `parity.rs` prints, from the engine's TS interface. */
export function runParityCases(engine: Engine, cases: readonly ParityCase[]): ParityResult[] {
	return cases.map((parityCase): ParityResult => {
		if (parityCase.kind === "once")
			return outcome(engine.executeOnce(parityCase.scope, parityCase.command));
		if (parityCase.kind === "ticks")
			return {
				ticks: parityCase.seconds.map((seconds) => {
					const ticks = engine.secondsToTicks(seconds);
					return Number.isNaN(ticks) ? null : ticks;
				}),
			};
		const opened = engine.open(parityCase.scope);
		if (!opened.ok)
			return {
				open: { error: JSON.stringify({ kind: opened.error.kind, message: opened.error.message }) },
			};
		const steps = parityCase.commands.map((command) =>
			outcome(engine.execute(opened.value, command)),
		);
		const last = outcome(engine.read(opened.value));
		const closed = engine.close(opened.value).ok;
		return { steps, final: last, closed, open: engine.openCount() };
	});
}
