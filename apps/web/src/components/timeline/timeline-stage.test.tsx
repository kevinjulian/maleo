// @vitest-environment happy-dom
import { expect, test, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { storyboardSchema } from "@maleo/video/composition";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createEditorChromeStore } from "@stores/editor-chrome-store.ts";
import { createDocumentWriters } from "@stores/document-writers.ts";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { DEFAULT_SETTINGS } from "@models/presets/creative-settings.ts";
import { TimelineStage, type TimelineStageProps } from "./timeline-stage.tsx";

vi.mock("./remotion-preview.tsx", () => ({ VuiRemotionPreview: () => null }));
vi.mock("./timeline-stage-menus.tsx", () => ({ TimelineStageMenus: () => null }));

test.each([false, true])("preview failure notice matches stalled=%s", (stalled) => {
	const store = createTimelineDocumentStore();
	const storyboard = storyboardSchema.parse({ scenes: [] });
	const library: Partial<TimelineStageProps["library"]> = { pool: [] };
	const view: Partial<TimelineStageProps["view"]> = {
		stalled,
		playhead: createPlayheadHandle(0),
		playerRef: { current: null },
		previewFps: 30,
		previewDims: { w: 640, h: 360 },
		previewProps: storyboard,
		previewStoryboard: storyboard,
		previewForDoc: () => storyboard,
		previewFrames: 30,
		aspect: 16 / 9,
		gen: {},
		selectedClip: null,
	};
	const props: TimelineStageProps = {
		store,
		writers: createDocumentWriters({ store, commit: store.setDoc }),
		chromeStore: createEditorChromeStore(),
		library: library as TimelineStageProps["library"],
		creative: { settings: DEFAULT_SETTINGS, elementSources: {} } as TimelineStageProps["creative"],
		projectId: null,
		trackFlags: {},
		canvasRef: { current: null },
		ops: {} as TimelineStageProps["ops"],
		view: view as TimelineStageProps["view"],
	};
	const host = document.createElement("div");
	host.innerHTML = renderToStaticMarkup(<TimelineStage {...props} />);
	const notice = host.querySelector('[role="status"]');
	if (stalled)
		expect(notice?.textContent).toBe("Preview cannot play this clip. Press Play to try again.");
	else expect(notice).toBeNull();
});
