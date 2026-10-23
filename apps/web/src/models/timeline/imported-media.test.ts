import { expect, test } from "vite-plus/test";
import type { ImportedMediaMetadata } from "@maleo/shared";
import { admitMediaAsset } from "./media-admission.ts";
import {
	parseLoadedProject,
	type LoadedProjectDetail,
} from "../storyboard/parse-loaded-project.ts";
import type { MediaAsset } from "./editor-media.ts";

test("import admission and reload retain stable IDs and original metadata without changing legacy URL identity", () => {
	const metadata: ImportedMediaMetadata = {
		originalFilename: "Original camera.MOV",
		byteSize: 100,
		kind: "video",
		frameRate: { mode: "variable", average: { numerator: 2997, denominator: 100 } },
	};
	const imported = admitMediaAsset([], {
		id: "import-stable",
		label: "Renamed",
		kind: "video",
		source: "upload",
		url: "/api/media/playback",
		metadata,
		compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
		importedSource: {
			revision: "r1",
			fingerprint: "a".repeat(64),
			originalMediaId: "original",
			playbackMediaId: "playback",
		},
	});
	expect(imported.id).toBe("import-stable");
	expect(admitMediaAsset(imported.assets, { ...imported.assets[0]!, id: "retry" })).toEqual({
		assets: imported.assets,
		id: "import-stable",
		added: false,
	});
	const legacy: MediaAsset[] = (["generated", "stock", "reference"] as const).map((source) => ({
		id: source,
		source,
		label: source,
		url: `/${source}.png`,
		kind: "image",
	}));
	const detail: LoadedProjectDetail = {
		project: {
			id: "p1",
			title: "Import",
			type: "video",
			target_audience: null,
			target_duration_sec: null,
			target_format: null,
			target_platform: null,
			brief_json: null,
			editor_state_json: null,
		},
		storyboards: [],
		mediaAssets: [...imported.assets, ...legacy],
	};
	const loaded = parseLoadedProject(detail);
	expect(loaded.mediaAssets).toEqual([...imported.assets, ...legacy]);
	expect(loaded.mediaAssets[0]?.metadata?.originalFilename).toBe("Original camera.MOV");
	expect(loaded.mediaAssets[0]?.metadata?.duration).toBeUndefined();
	expect(loaded.mediaAssets[1]).not.toHaveProperty("metadata");
	const malformed = structuredClone(detail);
	(malformed.mediaAssets as typeof imported.assets)[0]!.metadata!.duration = -1;
	expect(parseLoadedProject(malformed).mediaAssets[0]).not.toHaveProperty("metadata");
});
