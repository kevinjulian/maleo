import { describe, expect, it } from "vite-plus/test";
import {
	defaultClipInspectorTab,
	inspectorSubjectLabel,
	nextTimelineFollowScroll,
	opensSceneEditorOnDoubleClick,
} from "@models/timeline/timeline-editor-model.ts";

describe("timeline editor drawer routing", () => {
	it("opens scene editor from video clip double click only", () => {
		expect(opensSceneEditorOnDoubleClick("video")).toBe(true);
		expect(opensSceneEditorOnDoubleClick("voice")).toBe(false);
		expect(opensSceneEditorOnDoubleClick("music")).toBe(false);
	});

	it("opens audio clips on editable levels", () => {
		expect(defaultClipInspectorTab("audio")).toBe("levels");
		expect(defaultClipInspectorTab("text")).toBe("content");
	});

	it("summarizes inspector selection without leaking raw ids", () => {
		expect(inspectorSubjectLabel({ selectedCount: 3 })).toBe("3 clips selected");
		expect(inspectorSubjectLabel({ kind: "broll" })).toBe("Media overlay");
		expect(inspectorSubjectLabel({ kind: "scene", title: "Scene · Hook" })).toBe("Scene · Hook");
		expect(inspectorSubjectLabel({})).toBe("No selection");
	});
});

describe("timeline playhead follow scroll", () => {
	it("keeps the playhead inside the lane viewport when gutter is sticky", () => {
		const next = nextTimelineFollowScroll({
			scrollLeft: 0,
			clientWidth: 600,
			scrollWidth: 1800,
			gutterWidth: 112,
			playheadX: 540,
			padding: 96,
		});

		expect(next).toBe(148);
	});

	it("does not scroll while playhead is already within padded viewport", () => {
		expect(
			nextTimelineFollowScroll({
				scrollLeft: 148,
				clientWidth: 600,
				scrollWidth: 1800,
				gutterWidth: 112,
				playheadX: 540,
				padding: 96,
			}),
		).toBe(148);
	});
});
