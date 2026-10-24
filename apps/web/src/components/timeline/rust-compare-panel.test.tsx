// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vite-plus/test";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { PreviewState } from "@models/timeline/preview-protocol.ts";

const PREVIEW: PreviewState = {
	status: "playing",
	message: null,
	position: 4,
	frame: 120,
	dropped: 3,
	times: { last: 21.04, p50: 18, p95: 25.5, count: 40 },
	drift: 1.6,
	coverage: [],
	error: null,
};

vi.mock("@hooks/timeline/use-rust-compare.ts", () => ({
	playerSignals: () => ({}),
	useRustCompare: () => ({ status: "ready", preview: PREVIEW }),
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RustComparePanel, sessionLine } = await import("./rust-compare-panel.tsx");

describe("compare panel", () => {
	test("shows the frame times, dropped frames and drift in frames", async () => {
		const host = document.createElement("div");
		const root = createRoot(host);
		await act(async () =>
			root.render(
				createElement(RustComparePanel, {
					storyboard: {},
					playhead: createPlayheadHandle(0),
					playerRef: { current: null },
					fps: 30,
					durationFrames: 300,
					width: 1080,
					height: 1920,
				}),
			),
		);
		expect(host.textContent).toContain("Frame 21.0 ms · p50 18.0 ms · p95 25.5 ms (40)");
		expect(host.textContent).toContain("3 dropped");
		expect(host.textContent).toContain("drift +2 f");
		await act(async () => root.unmount());
	});

	test("rounds drift to whole frames and waits for the first frame", () => {
		expect(sessionLine({ ...PREVIEW, times: null, dropped: 0, drift: -0.4 })).toBe(
			"Waiting for a frame · 0 dropped · drift 0 f",
		);
		expect(sessionLine({ ...PREVIEW, drift: -2.6 })).toContain("drift -3 f");
		expect(sessionLine({ ...PREVIEW, drift: null })).toContain("drift —");
	});
});
