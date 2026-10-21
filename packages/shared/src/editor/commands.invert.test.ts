/* Generated invert tests: for every command type, random commands built against
 * realistic scopes must satisfy apply -> invert -> apply === the prior scope.
 *
 * The golden fixtures pin one example per case; this pins the property itself,
 * so a patch that adds a field, an index at the end of a list or an absent
 * document field is exercised without someone having thought to write it down.
 * Any other executor (the Rust core) is held to the same property.
 *
 * Seeded and deterministic: a failure names its seed and command, and
 * `INVERT_SEED=<n>` replays one case. */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	NUMERIC_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTY_NAMES,
} from "../animation-properties.ts";
import type { Clip } from "../timeline-doc.ts";
import { syntheticCorpusScope } from "./corpus/synthetic.ts";
import { EDITOR_COMMAND_TYPES, type EditorCommand, type EditorCommandType } from "./commands.ts";
import { applyCommand, invertCommand } from "./engine-registry.ts";
import type { EditScope } from "./scope.ts";

const RUNS_PER_TYPE = 300;
const FIXTURES = join(import.meta.dirname, "fixtures");

const CORPUS = join(import.meta.dirname, "corpus", "scopes");

/* Every fixture's input scope (hand-written cases for every command) plus the
 * sanitized real-project corpus (`scripts/export-editor-corpus.ts`), whose
 * shapes nobody chose — the drift hand-written fixtures cannot reveal. */
const FIXTURE_SCOPES: EditScope[] = readdirSync(FIXTURES).flatMap((dir) =>
	readdirSync(join(FIXTURES, dir))
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(readFileSync(join(FIXTURES, dir, name), "utf8")).scope as EditScope),
);
/* Real exports first; the synthetic scope adds features no real project uses yet. */
const CORPUS_SCOPES: EditScope[] = [
	...readdirSync(CORPUS)
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(readFileSync(join(CORPUS, name), "utf8")) as EditScope),
	syntheticCorpusScope(),
];
const SCOPES: EditScope[] = [...FIXTURE_SCOPES, ...CORPUS_SCOPES];

type Rng = () => number;
function rngFor(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const chance = (rng: Rng, p = 0.5): boolean => rng() < p;
const between = (rng: Rng, lo: number, hi: number): number =>
	Math.round((lo + rng() * (hi - lo)) * 1000) / 1000;
const maybeIndex = (rng: Rng, length: number): number | undefined =>
	chance(rng, 0.3) ? undefined : Math.floor(rng() * (length + 1));

/* A patch of random fields from a pool, so a patch can add a field the entity
 * lacks, overwrite one it has, or both. */
function patchFrom<T>(rng: Rng, pool: Record<string, (rng: Rng) => unknown>): Partial<T> {
	const keys = Object.keys(pool).filter(() => chance(rng, 0.4));
	const chosen = keys.length > 0 ? keys : [pick(rng, Object.keys(pool))];
	return Object.fromEntries(chosen.map((key) => [key, pool[key]!(rng)])) as Partial<T>;
}

const CLIP_FIELDS = {
	startSec: (r: Rng) => between(r, 0, 20),
	durationSec: (r: Rng) => between(r, 0.1, 8),
	track: (r: Rng) => Math.floor(r() * 4),
	markerId: (r: Rng) => 1 + Math.floor(r() * 3),
	refIds: (r: Rng) => (chance(r) ? [] : ["ref-a", "ref-b"].slice(0, 1 + Math.floor(r() * 2))),
	useGlobalReferences: (r: Rng) => chance(r),
};
const MARKER_FIELDS = {
	title: (r: Rng) => pick(r, ["Hook", "Proof", "Close"]),
	beat: () => "beat",
	voiceoverText: (r: Rng) => (chance(r) ? "" : "Say this"),
	startSec: (r: Rng) => between(r, 0, 10),
	endSec: (r: Rng) => between(r, 10, 20),
	clipIds: () => [],
};
const SLIDE_FIELDS = {
	name: () => "Named",
	cap: () => "Edited",
	vis: () => "a new shot",
	img: (r: Rng) => chance(r),
	seed: (r: Rng) => Math.floor(r() * 1000),
	src: () => "/api/media/x",
	refIds: () => ["ref-a"],
	noteIds: () => [],
};
const POST_FIELDS = {
	body: () => "Edited",
	img: (r: Rng) => chance(r),
	seed: (r: Rng) => Math.floor(r() * 1000),
	src: () => "/api/media/x",
};

/* A value some fixture scope has for this document field, or absent. */
function docValue<K extends "captions" | "projectReferences" | "materials" | "trackFlags">(
	rng: Rng,
	key: K,
): EditScope["doc"][K] {
	const values = SCOPES.map((s) => s.doc[key]).filter((v) => v !== undefined);
	return chance(rng, 0.25) || values.length === 0 ? undefined : pick(rng, values);
}

function keysFor(rng: Rng, clip: Clip): EditorCommand {
	const property = pick(rng, NUMERIC_ANIMATION_PROPERTY_NAMES);
	const spec = NUMERIC_ANIMATION_PROPERTIES[property];
	const count = Math.floor(rng() * 4);
	const keys = Array.from({ length: count }, (_, i) => ({
		t: between(rng, (i * clip.durationSec) / 4, ((i + 1) * clip.durationSec) / 4),
		v: between(rng, spec.min, spec.max),
	}));
	return { type: "clip.setKeys", id: clip.id, property, keys };
}

/* One command of `type`, valid enough to reach the executor's real paths. Ids
 * name existing entities, because inverting an edit to a missing clip is
 * documented to throw rather than guess. */
function commandOf(rng: Rng, type: EditorCommandType, scope: EditScope): EditorCommand | undefined {
	// Caption timing/protection uses caption.edit; arbitrary clip patches can be invalid.
	const clips = scope.doc.clips.filter((clip) => clip.type !== "caption"),
		clip = clips.length > 0 ? pick(rng, clips) : undefined;
	const marker = scope.doc.markers.length > 0 ? pick(rng, scope.doc.markers) : undefined;
	const slide = scope.slides.length > 0 ? pick(rng, scope.slides) : undefined;
	const post = scope.posts.length > 0 ? pick(rng, scope.posts) : undefined;
	const at = (c: Clip) => between(rng, c.startSec, c.startSec + c.durationSec);
	switch (type) {
		case "caption.edit": {
			const cue = scope.doc.clips.find(
				(clip) => clip.type === "caption" && !scope.doc.trackFlags?.[clip.track]?.locked,
			);
			if (cue)
				return {
					type,
					edit: chance(rng)
						? { action: "update", id: cue.id, text: `Corrected ${Math.floor(rng() * 1000)}` }
						: {
								action: "timing",
								id: cue.id,
								startSec: between(rng, 0, 20),
								durationSec: between(rng, 0.1, 8),
							},
				};
			const template = FIXTURE_SCOPES.flatMap((item) => item.doc.clips).find(
				(clip) => clip.type === "caption",
			)!;
			let track = 0;
			while (scope.doc.trackFlags?.[track]?.locked) track++;
			return {
				type,
				edit: {
					action: "create",
					clip: { ...template, id: `caption:new-${Math.floor(rng() * 1e9)}`, track },
				},
			};
		}
		case "media.update":
			return { type, mediaAssets: scope.mediaAssets.filter(() => chance(rng, 0.6)) };
		case "media.admit": {
			const asset = scope.mediaAssets[0];
			return asset
				? { type, asset: { ...asset, id: `asset-${Math.floor(rng() * 1e6)}` } }
				: undefined;
		}
		case "clip.replace":
			return (
				clip && {
					type,
					id: clip.id,
					clip: { ...clip, ...patchFrom<Clip>(rng, CLIP_FIELDS), id: clip.id },
				}
			);
		case "clip.update":
			return clip && { type, id: clip.id, patch: patchFrom<Clip>(rng, CLIP_FIELDS) };
		case "clip.move":
			return (
				clip && {
					type,
					id: clip.id,
					patch: {
						startSec: between(rng, 0, 20),
						...(chance(rng) ? { track: Math.floor(rng() * 4) } : {}),
					},
				}
			);
		case "clip.resize":
			return (
				clip && {
					type,
					id: clip.id,
					durationSec: between(rng, 0, 10),
					...(chance(rng) ? { startSec: between(rng, 0, 20) } : {}),
				}
			);
		case "clip.trim-before":
		case "clip.trim-after":
			return clip && { type, id: clip.id, at: at(clip) };
		case "clip.setKeys":
			return clip && keysFor(rng, clip);
		case "clip.insert":
			return (
				clip && {
					type,
					clip: { ...clip, id: `${clip.type}:new-${Math.floor(rng() * 1e6)}` },
					...(() => {
						const index = maybeIndex(rng, clips.length);
						return index === undefined ? {} : { index };
					})(),
				}
			);
		case "clip.remove":
			return clip && { type, id: clip.id };
		case "marker.upsert":
			return {
				type,
				marker:
					marker && chance(rng)
						? { ...marker, ...patchFrom(rng, MARKER_FIELDS) }
						: {
								id: 100 + Math.floor(rng() * 100),
								title: "New",
								clipIds: [],
								startSec: 0,
								endSec: 1,
							},
			};
		case "marker.update":
			return marker && { type, id: marker.id, patch: patchFrom(rng, MARKER_FIELDS) };
		case "marker.remove":
			return { type, id: marker && chance(rng, 0.8) ? marker.id : 9999 };
		case "bookmark.set":
			return chance(rng, 0.3)
				? { type }
				: { type, bookmarks: [{ id: "bm-x", label: "Beat", timeSec: between(rng, 0, 20) }] };
		case "bookmark.upsert": {
			const existing = scope.doc.bookmarks?.[0];
			return {
				type,
				bookmark: {
					id: existing && chance(rng) ? existing.id : `bm-${Math.floor(rng() * 1e6)}`,
					label: "Beat",
					timeSec: between(rng, 0, 20),
				},
			};
		}
		case "bookmark.remove":
			return {
				type,
				id: scope.doc.bookmarks?.[0] && chance(rng, 0.8) ? scope.doc.bookmarks[0].id : "missing",
			};
		case "doc.setCaptions": {
			const captions = docValue(rng, "captions");
			return captions === undefined ? { type } : { type, captions };
		}
		case "doc.setProjectReferences": {
			const projectReferences = docValue(rng, "projectReferences");
			return projectReferences === undefined ? { type } : { type, projectReferences };
		}
		case "doc.setMaterials": {
			const materials = docValue(rng, "materials");
			return materials === undefined ? { type } : { type, materials };
		}
		case "doc.setTrackFlags":
			return chance(rng, 0.25)
				? { type }
				: {
						type,
						trackFlags: {
							[Math.floor(rng() * 4)]: {
								hidden: chance(rng),
								locked: chance(rng),
								muted: chance(rng),
							},
						},
					};
		case "slide.insert": {
			const index = maybeIndex(rng, scope.slides.length);
			return {
				type,
				slide: {
					key: `slide-${Math.floor(rng() * 1e6)}`,
					id: 900 + Math.floor(rng() * 99),
					cap: "c",
					vis: "v",
					img: false,
				},
				...(index === undefined ? {} : { index }),
			};
		}
		case "slide.remove":
			return slide && { type, id: slide.id };
		case "slide.update":
			return slide && { type, id: slide.id, patch: patchFrom(rng, SLIDE_FIELDS) };
		case "post.insert": {
			const index = maybeIndex(rng, scope.posts.length);
			return {
				type,
				post: {
					key: `post-${Math.floor(rng() * 1e6)}`,
					id: 900 + Math.floor(rng() * 99),
					body: "b",
					img: false,
				},
				...(index === undefined ? {} : { index }),
			};
		}
		case "post.remove":
			return post && { type, id: post.id };
		case "post.update":
			return post && { type, id: post.id, patch: patchFrom(rng, POST_FIELDS) };
		case "scope.replace":
			return { type, scope: pick(rng, SCOPES), ...(chance(rng) ? { label: "edit" } : {}) };
		case "noop":
			return { type };
		case "batch": {
			const commands: EditorCommand[] = [];
			let state = scope;
			for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) {
				const sub = commandOf(
					rng,
					pick(
						rng,
						EDITOR_COMMAND_TYPES.filter((t) => t !== "batch"),
					),
					state,
				);
				if (!sub) continue;
				commands.push(sub);
				state = applyCommand(state, sub);
			}
			return { type, commands, ...(chance(rng) ? { label: "grouped" } : {}) };
		}
	}
}

/* Mutation would make a round trip pass against an already-changed input, so
 * the prior scope is snapshotted as JSON before anything executes. */
function roundTrip(seed: number, type: EditorCommandType): boolean {
	return roundTripFrom(seed, type, SCOPES);
}

function roundTripFrom(seed: number, type: EditorCommandType, from: readonly EditScope[]): boolean {
	const rng = rngFor(seed);
	const before = pick(rng, from);
	const command = commandOf(rng, type, before);
	if (!command) return false;
	const snapshot = JSON.stringify(before);
	const after = applyCommand(before, command);
	const restored = applyCommand(after, invertCommand(before, command));
	if (JSON.stringify(before) !== snapshot)
		throw new Error(`seed ${seed}: ${type} mutated its input`);
	if (!isDeepStrictEqual(restored, before))
		throw new Error(
			`seed ${seed}: ${type} inverse did not restore the prior scope\n${JSON.stringify(command)}`,
		);
	return true;
}

const replay = process.env.INVERT_SEED === undefined ? undefined : Number(process.env.INVERT_SEED);

describe("generated invert round trips", () => {
	test("fixture and corpus scopes are available to generate from", () => {
		expect(FIXTURE_SCOPES.length).toBeGreaterThan(EDITOR_COMMAND_TYPES.length);
		expect(CORPUS_SCOPES.length).toBeGreaterThan(0);
	});

	test("corpus scopes survive a JSON round trip unchanged", () => {
		for (const scope of CORPUS_SCOPES)
			expect(JSON.parse(JSON.stringify(scope))).toStrictEqual(scope);
	});

	/* Half the runs start from a real scope, so corpus shapes are exercised for
	 * every command type rather than diluted among the fixtures. */
	for (const [index, type] of EDITOR_COMMAND_TYPES.entries()) {
		test(`${type}: round trips on real-project corpus scopes`, () => {
			const exercised = Array.from(
				{ length: RUNS_PER_TYPE },
				(_, run) => 7_000_000 + index * 100_000 + run,
			).filter((seed) => roundTripFrom(seed, type, CORPUS_SCOPES)).length;
			/* A command only goes unbuilt when its target list is empty (no real
			 * project has posts yet), which does not depend on the seed. */
			const hostable = CORPUS_SCOPES.some(
				(scope) => commandOf(rngFor(1), type, scope) !== undefined,
			);
			expect(exercised > 0).toBe(hostable);
		});
	}

	for (const [index, type] of EDITOR_COMMAND_TYPES.entries()) {
		test(`${type}: apply then invert restores the prior scope`, () => {
			const seeds =
				replay === undefined
					? Array.from({ length: RUNS_PER_TYPE }, (_, run) => index * 100_000 + run)
					: [replay];
			const exercised = seeds.filter((seed) => roundTrip(seed, type)).length;
			/* A generator that silently produced nothing would pass vacuously. */
			expect(exercised).toBeGreaterThan(replay === undefined ? RUNS_PER_TYPE / 2 : 0);
		});
	}
});
