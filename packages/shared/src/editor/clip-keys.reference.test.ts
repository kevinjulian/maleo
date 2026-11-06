/* The key rules against `inspector-reference/clip-keys.reference.json`
 * (`p1-envelope-inspector` task 3.3). Recorded from the TypeScript rules before
 * they moved into the engine; this suite holds the TS wrappers to it, and
 * `crates/app-core/tests/inspector_reference.rs` holds the Rust rules to it.
 * Regenerate only for a deliberate behavior change, with `MALEO_UPDATE_REFERENCE=1`. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	clipKeyError,
	keyTarget,
	nearKeyIndex,
	upsertKey,
	type AnimationKey,
} from "./clip-keys.ts";
import { syntheticCorpusScope } from "./corpus/synthetic.ts";
import type { EditScope } from "./scope.ts";

const EDITOR = import.meta.dirname;
const REFERENCE = join(EDITOR, "inspector-reference", "clip-keys.reference.json");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/* The scopes the rules read: the corpus, the synthetic scope with features no
 * real project uses yet, the `clip.setKeys` fixtures, and the synthetic scope
 * with every track locked. */
function scopes(): { name: string; scope: EditScope }[] {
	const found: { name: string; scope: EditScope }[] = [];
	const corpus = join(EDITOR, "corpus", "scopes");
	for (const file of readdirSync(corpus).sort())
		found.push({ name: `corpus/${file}`, scope: readJson(join(corpus, file)) as EditScope });
	const setKeys = join(EDITOR, "fixtures", "clip.setKeys");
	for (const file of readdirSync(setKeys).sort())
		found.push({
			name: `clip.setKeys/${file}`,
			scope: (readJson(join(setKeys, file)) as { scope: EditScope }).scope,
		});
	const synthetic = syntheticCorpusScope();
	found.push({ name: "synthetic", scope: synthetic });
	const tracks = [-1, ...new Set(synthetic.doc.clips.map((clip) => clip.track))];
	found.push({
		name: "synthetic-locked",
		scope: {
			...synthetic,
			doc: {
				...synthetic.doc,
				trackFlags: Object.fromEntries(tracks.map((track) => [String(track), { locked: true }])),
			},
		} as EditScope,
	});
	return found;
}

const PROPERTIES = ["xPct", "scale", "opacity", "fontSize", "fill", "volume", "bogus"];
const KEYSETS: AnimationKey[][] = [
	[],
	[{ t: 0, v: 1 }],
	[
		{ t: 0, v: 1 },
		{ t: 0.5, v: 0.5, easing: "out" },
	],
	[
		{ t: 0.5, v: 1 },
		{ t: 0.5, v: 2 },
	],
	[{ t: -1, v: 0 }],
	[{ t: 1e6, v: 0 }],
	[{ t: 0, v: "#ffffff" }],
	[{ t: 0, v: 1000 }],
	[{ t: Number.NaN, v: 0 }],
];
const TRACK = [
	{ t: 0, v: 0 },
	{ t: 0.5, v: 10, easing: "out" as const },
	{ t: 1, v: 20 },
];
const TIMES = [-0.2, 0, 0.04, 0.09, 0.1, 0.11, 0.3, 0.5, 0.56, 0.6, 0.95, 1, 1.2];

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

function record() {
	/* Each refusal message once; a target's errors are message indexes, one row
	 * per property and one column per key set (-1 is no refusal). */
	const messages: string[] = [];
	const index = (message: string | null): number => {
		if (message === null) return -1;
		const known = messages.indexOf(message);
		return known >= 0 ? known : messages.push(message) - 1;
	};
	const targets: unknown[] = [];
	const all = scopes();
	for (const { name, scope } of all)
		for (const id of [...scope.doc.clips.map((clip) => clip.id), "missing:1"]) {
			const target = keyTarget(scope.doc, id);
			targets.push({
				scope: name,
				id,
				target: target
					? plain({
							kind: target.kind,
							animation: target.animation,
							duration: target.duration,
							locked: target.locked,
						})
					: null,
				errors: PROPERTIES.map((property) =>
					KEYSETS.map((keys) => index(clipKeyError(scope.doc, id, property, keys))),
				),
			});
		}
	return {
		/* The scopes a Rust test cannot rebuild from files. */
		generated: Object.fromEntries(
			all
				.filter(({ name }) => name.startsWith("synthetic"))
				.map(({ name, scope }) => [name, scope]),
		),
		properties: PROPERTIES,
		keysets: plain(KEYSETS),
		messages,
		targets,
		nearKeyIndex: TIMES.flatMap((time) =>
			[0.1, 0.05].map((snap) => ({ time, snap, out: nearKeyIndex(TRACK, time, snap) })),
		),
		track: TRACK,
		upsertKey: TIMES.flatMap((time) =>
			[undefined, "in" as const].map((easing) => ({
				time,
				easing: easing ?? null,
				out: plain(upsertKey(TRACK, time, 7, easing)),
			})),
		),
	};
}

type Recorded = ReturnType<typeof record>;

/* The engine names a refused key edit in its own words after the colon; the
 * recorded TS named the first zod issue. Both share the stable prefix. */
const prefix = (message: string): string => message.replace(/ clip: .*$/, " clip:");
/** Each target's errors as messages (prefix only), so message order does not matter. */
const errors = (value: Recorded) =>
	(value.targets as { scope: string; id: string; errors: number[][] }[]).map((target) => ({
		...target,
		errors: target.errors.map((row) =>
			row.map((at) => (at < 0 ? null : prefix(value.messages[at]!))),
		),
	}));

describe("key rules", () => {
	test("match the recorded reference the Rust rules are held to", () => {
		const actual = plain(record()) as Recorded;
		if (process.env.MALEO_UPDATE_REFERENCE === "1")
			writeFileSync(REFERENCE, `${JSON.stringify(actual)}\n`);
		const expected = readJson(REFERENCE) as Recorded;
		expect(errors(actual)).toEqual(errors(expected));
		const { messages: _a, targets: _b, ...rest } = actual;
		const { messages: _c, targets: _d, ...recorded } = expected;
		expect(rest).toEqual(recorded);
	});
});
