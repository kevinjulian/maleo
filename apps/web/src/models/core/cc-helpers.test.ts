import { describe, expect, it } from "vite-plus/test";
import { mediaUrl, mintMediaId, toTimelineDoc } from "@maleo/shared";
import { buildRenderPreflight } from "./cc-helpers.ts";
import { clearPendingSources, trackPendingSource } from "./pending-media-sources.ts";

describe("render export preflight", () => {
	it("adds no draft disclosures for composited clips and refuses unsupported saved values", () => {
		const layout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			fit: "cover" as const,
			blendMode: "screen" as const,
			color: { brightness: 0.5, contrast: 1, saturation: 1 },
		};
		const input = {
			scenes: [],
			videoOverlays: [{ url: "/image.png", layout }],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
		};
		expect(buildRenderPreflight(input).warnings.join(" ")).not.toContain("draft");
		expect(
			buildRenderPreflight({
				...input,
				videoOverlays: [
					{ url: "/image.png", layout: { ...layout, color: { ...layout.color, brightness: NaN } } },
				],
			}).blockers.join(" "),
		).toContain("invalid color");
	});
	it("refuses a clip whose source turned out shorter than its placed range once the server measured it", () => {
		const doc = toTimelineDoc(
			[],
			[
				{
					id: 2,
					kind: "video",
					url: "/api/media/x",
					mediaAssetId: "k1",
					start: 0,
					dur: 4.6,
					mediaStartSec: 0.5,
					track: 0,
				},
			],
		);
		const asset = {
			id: "k1",
			label: "beach.mov",
			url: "/api/media/x",
			kind: "video" as const,
			source: "upload" as const,
			metadata: { originalFilename: "beach.mov", byteSize: 1, kind: "video" as const, duration: 5 },
		};
		const input = {
			scenes: [],
			videoOverlays: [],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
			mediaAssets: [asset],
			clips: doc.clips,
		};
		expect(buildRenderPreflight(input).blockers).toContain(
			"beach.mov: the clip runs past the end of its source. Trim it before export.",
		);
		expect(
			buildRenderPreflight({
				...input,
				mediaAssets: [{ ...asset, metadata: { ...asset.metadata, duration: 5.2 } }],
			}).blockers.join(" "),
		).not.toContain("beach.mov");
	});
	it("a file still uploading refuses both browser and server export, naming the file", () => {
		const id = mintMediaId();
		trackPendingSource(id);
		const doc = toTimelineDoc(
			[],
			[{ id: 2, kind: "video", url: mediaUrl(id), mediaAssetId: id, start: 0, dur: 2, track: 0 }],
		);
		const asset = {
			id,
			label: "beach.mov",
			url: mediaUrl(id),
			kind: "video" as const,
			source: "upload" as const,
			dur: 2,
			metadata: { originalFilename: "beach.mov", byteSize: 1, kind: "video" as const, duration: 2 },
		};
		const result = buildRenderPreflight({
			scenes: [],
			videoOverlays: [{ url: mediaUrl(id) }],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
			mediaAssets: [asset],
			clips: doc.clips,
		});
		expect(result.blockers).toEqual([
			"beach.mov is still uploading. Wait for it to finish before export.",
		]);
		expect(result.warnings.join(" ")).not.toContain("browser's copy");
		clearPendingSources();
	});
	it("blocks pending and unresolved reverse processing without hiding other export checks", () => {
		const result = buildRenderPreflight({
			scenes: [],
			videoOverlays: [
				{
					url: "/original.mp4",
					dur: 2,
					layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", reverse: true },
				},
			],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
			processingSources: ["Camera"],
		});
		expect(result.blockers).toHaveLength(2);
		expect(result.blockers.join(" ")).toContain("reverse source is unavailable");
		expect(result.blockers.join(" ")).toContain("Camera: source processing is still pending");
	});
	it("blocks empty video exports", () => {
		const result = buildRenderPreflight({
			scenes: [],
			videoOverlays: [],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
		});

		expect(result.blockers).toContain("Add media, text, or generate a storyboard.");
		expect(result.summary).toBe("1 blocker");
	});

	it("blocks missing media while retaining other project warnings", () => {
		const result = buildRenderPreflight({
			scenes: [{ src: "", img: false, vo: "" }],
			videoOverlays: [{ url: "" }],
			audioOverlays: [],
			textOverlays: [],
			effects: [{}],
			agentRunning: true,
			rendering: false,
		});

		expect(result.blockers).toContain(
			"1 media clip has no source file. Replace missing sources before export.",
		);
		expect(result.warnings).toContain("Generation still running; export may miss newer edits.");
		expect(result.warnings).toContain("1 scene has no visual frame.");
		expect(result.summary).toBe("1 blocker");
	});

	it("marks populated export ready", () => {
		const result = buildRenderPreflight({
			scenes: [{ src: "/frame.png", img: true, vo: "Line" }],
			videoOverlays: [],
			audioOverlays: [{ url: "/voice.wav", kind: "voiceover" }],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
		});

		expect(result.blockers).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.summary).toBe("Ready to export");
	});

	it("blocks only used incompatible sources including scene clips, leaving unplaced failures visible", () => {
		const asset = {
			id: "file",
			label: "Footage",
			kind: "video" as const,
			source: "upload" as const,
			url: "/footage",
			compatibility: {
				preview: { status: "supported" as const },
				render: { status: "failed" as const, reason: "Conversion failed" },
			},
		};
		const input = {
			scenes: [],
			videoOverlays: [{ url: asset.url, mediaAssetId: asset.id }],
			audioOverlays: [],
			textOverlays: [],
			effects: [],
			agentRunning: false,
			rendering: false,
			mediaAssets: [asset],
		};
		expect(buildRenderPreflight(input).blockers).toEqual([
			"Footage: Conversion failed. Replace source before export.",
		]);
		expect(
			buildRenderPreflight({ ...input, videoOverlays: [{ url: "/legacy" }] }).blockers,
		).toEqual([]);
		expect(
			buildRenderPreflight({
				...input,
				videoOverlays: [],
				scenes: [{ visualClips: [{ url: asset.url, mediaAssetId: asset.id }] }],
			}).blockers,
		).toHaveLength(1);
	});
});
