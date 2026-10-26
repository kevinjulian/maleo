import { describe, expect, test } from "bun:test";
import { overlaysFromV2Clips } from "./persistence.ts";
import {
	readStoryboardDocument,
	writeStoryboardDocument,
	SCENE_TEXT_CLIP_MIGRATION_VERSION,
} from "@maleo/shared";

/* These pinned `preservedClientStoryboardFields`, the hand-listed carry-forward
 * the agent used to spread over its writes. The mechanism is gone — the agent now
 * reads the prior document and supplies the editor's fields explicitly — but the
 * properties it protected still have to hold, so they are asserted against the
 * read/write pair that replaced it. */
describe("what the agent carries forward across its writes", () => {
	const carry = (prev: Record<string, unknown>): Record<string, unknown> => {
		const prior = readStoryboardDocument(prev).doc;
		return writeStoryboardDocument({
			schemaVersion: 2,
			sceneTextClipMigrationVersion: SCENE_TEXT_CLIP_MIGRATION_VERSION,
			trackFlags: null,
			presentation: null,
			clips: [],
			markers: [],
			chapters: prior.chapters,
			bookmarks: prior.bookmarks,
			projectReferences: prior.projectReferences,
			materials: prior.materials,
			captions: prior.captions,
			captionSet: prior.captionSet,
			pacingDevices: prior.pacingDevices,
			unitLifecycle: null,
			artifacts: [],
		});
	};

	test("keeps project refs and presentation settings across repeated agent snapshots", () => {
		const clientState = {
			bookmarks: [{ id: "client-point", timeSec: 42, label: "Check pacing" }],
			projectReferences: { prompt: "@Sketch", entityIds: ["sketch"] },
			captions: { enabled: true },
			pacingDevices: { chapterPills: true },
		};
		const first = carry(clientState);
		const second = carry(first);

		expect(second).toMatchObject(clientState);
		// Idempotent: a second agent write changes nothing the editor owns.
		expect(second).toEqual(first);
	});

	test("flattens a four-bucket selection written before the migration", () => {
		const legacy = {
			prompt: "@Sketch",
			mediaAssetIds: ["refmedia:sketch"],
			imageIds: ["sketch"],
			noteIds: [],
			productIds: [],
		};
		expect(carry({ projectReferences: legacy }).projectReferences).toEqual({
			prompt: "@Sketch",
			entityIds: ["sketch"],
		});
	});

	test("preserves an intentional empty project-ref selection", () => {
		// Empty is a selection, not an absence: it must not come back as null, or
		// the client's next autosave would make a transient reset durable.
		const empty = { prompt: "", entityIds: [] };
		expect(carry({ projectReferences: empty }).projectReferences).toEqual(empty);
	});
});

describe("overlaysFromV2Clips", () => {
	test("preserves retained plain text style from saved clips", () => {
		const out = overlaysFromV2Clips([
			{
				id: "text:51000000",
				type: "text",
				startSec: 0,
				durationSec: 4,
				track: 3,
				text: {
					id: 51_000_000,
					content: "Opening",
					start: 0,
					dur: 4,
					preset: "plain",
					style: {
						fontFamily: "Inter",
						fontSize: 64,
						weight: 700,
						fill: "#FFFFFF",
						align: "center",
					},
				},
			},
		]);
		expect(out.textOverlays[0]).toMatchObject({
			preset: "plain",
			track: 3,
			style: { weight: 700 },
		});
	});

	test("preserves audio kind and origin from saved clip docs", () => {
		const out = overlaysFromV2Clips([
			{
				id: "audio:1",
				type: "audio",
				startSec: 1,
				durationSec: 0.8,
				track: 0,
				audio: {
					id: 1,
					kind: "sfx",
					origin: "stock",
					content: "whoosh",
					url: "sfx.mp3",
					start: 1,
					dur: 0.8,
				},
			},
			{
				id: "audio:2",
				type: "audio",
				startSec: 2,
				durationSec: 5,
				track: 1,
				audio: { id: 2, kind: "ambient", content: "rain", url: "rain.mp3", start: 2, dur: 5 },
			},
			{
				id: "audio:3",
				type: "audio",
				startSec: 3,
				durationSec: 0.5,
				track: 2,
				audio: { id: 3, kind: "accent_hit", content: "sting", url: "hit.mp3", start: 3, dur: 0.5 },
			},
		]);

		expect(out.audioOverlays.map((a) => [a.kind, a.origin, a.content])).toEqual([
			["sfx", "stock", "whoosh"],
			["ambient", undefined, "rain"],
			["accent_hit", undefined, "sting"],
		]);
	});

	test("preserves measured voiceover source windows", () => {
		const out = overlaysFromV2Clips([
			{
				id: "audio:4",
				type: "audio",
				startSec: 8,
				durationSec: 6,
				track: 0,
				audio: {
					id: 4,
					kind: "voiceover",
					content: "second semantic segment",
					url: "voice.wav",
					start: 8,
					dur: 6,
					originalDur: 14,
					mediaStartSec: 8,
				},
			},
		]);

		expect(out.audioOverlays[0]).toMatchObject({
			durationSec: 6,
			originalDur: 14,
			mediaStartSec: 8,
		});
	});
});
