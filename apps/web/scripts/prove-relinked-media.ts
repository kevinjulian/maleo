#!/usr/bin/env bun
import {
	applyCommand,
	invertCommand,
	instantiateEngineSync,
	provideEditorEngine,
} from "@maleo/shared/editor";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEditorWasm } from "../../../scripts/editor-engine.mts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRenderStoryboardFromDoc,
	DEFAULT_CAPTIONS,
	type ReadyImportedMedia,
} from "@maleo/shared";
import {
	replaceProjectMedia,
	mediaSourceIdentity,
} from "../src/models/timeline/media-replacement.ts";
import type { EditScope } from "@maleo/shared/editor";

provideEditorEngine(() => instantiateEngineSync(readFileSync(buildEditorWasm())));

const asset = {
	id: "logical-source",
	label: "Missing footage",
	kind: "video" as const,
	source: "upload" as const,
	url: "",
};
const scope: EditScope = {
	mediaAssets: [asset],
	slides: [],
	posts: [],
	doc: {
		schemaVersion: 2,
		markers: [],
		clips: [
			{
				id: "scene:1",
				type: "image",
				startSec: 0,
				durationSec: 1.5,
				track: -1,
				scene: {
					id: 1,
					dur: 1.5,
					name: "Repair proof",
					shot: "Wide",
					move: "Static",
					vis: "",
					vo: "",
					img: true,
					src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='black'/%3E%3C/svg%3E",
				},
			},
			{
				id: "video:1",
				type: "video",
				startSec: 0,
				durationSec: 1.5,
				track: 0,
				video: {
					id: 1,
					kind: "video",
					mediaAssetId: asset.id,
					url: "",
					start: 0,
					dur: 1.5,
					layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "stretch" },
				},
			},
			{
				id: "audio:1",
				type: "audio",
				startSec: 0,
				durationSec: 1.5,
				track: 1,
				audio: {
					id: 1,
					kind: "voiceover",
					content: "",
					url: "synthetic-audio.m4a",
					start: 0,
					dur: 1.5,
					volume: 1,
				},
			},
		],
	},
};
const ready: ReadyImportedMedia = {
	id: "new-source",
	label: "repaired.mp4",
	source: "upload",
	kind: "video",
	url: "/api/media/00000000-0000-0000-0000-000000000001",
	dur: 1.5,
	metadata: { originalFilename: "repaired.mp4", byteSize: 42, kind: "video", duration: 1.5 },
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: {
		revision: "new-revision",
		originalMediaId: "immutable-source",
		fingerprint: "a".repeat(64),
	},
};
const command = replaceProjectMedia(scope, asset.id, mediaSourceIdentity(asset), ready);
const repaired = JSON.parse(JSON.stringify(applyCommand(scope, command)));
assert.equal(repaired.mediaAssets[0].id, asset.id);
assert.equal(repaired.doc.clips[1].video.url, ready.url);
assert.deepEqual(applyCommand(repaired, invertCommand(scope, command)), scope);
const storyboard = buildRenderStoryboardFromDoc(
	{ format: "16:9" },
	{ images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } },
	repaired.doc,
	{ captions: DEFAULT_CAPTIONS },
).storyboard;
assert.equal(storyboard.videoOverlays?.[0]?.url, ready.url);
const dir = await mkdtemp(join(tmpdir(), "maleo-relink-proof-"));
try {
	const path = join(dir, "storyboard.json");
	await Bun.write(path, JSON.stringify({ ...storyboard, showLabels: false }));
	const render = Bun.spawn(
		[
			process.execPath,
			new URL("../../../packages/video/scripts/prove-imported-media.ts", import.meta.url).pathname,
			path,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	assert.equal(await render.exited, 0, "Repaired production render failed");
} finally {
	await rm(dir, { recursive: true, force: true });
}
