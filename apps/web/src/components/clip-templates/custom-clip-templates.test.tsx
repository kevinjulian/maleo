// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ClipTemplate } from "@maleo/shared";
import { CustomTemplatesBlock } from "./custom-clip-templates.tsx";

const { load } = vi.hoisted(() => ({ load: vi.fn<() => Promise<ClipTemplate[]>>() }));
vi.mock("@api/templates.ts", () => ({
	listClipTemplates: load,
	createClipTemplate: vi.fn(),
	updateClipTemplate: vi.fn(),
	deleteClipTemplate: vi.fn(),
	saveCompositionTemplate: vi.fn(),
}));
vi.mock("@components/timeline/timeline-editor-panels.tsx", () => ({
	TextPresetPreview: () => <span />,
}));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
	await act(() => root.unmount());
	load.mockReset();
});
async function render(group: "motion" | "text" | "shapes" = "motion") {
	root = createRoot(host);
	await act(async () =>
		root.render(
			<CustomTemplatesBlock
				group={group}
				kind="text"
				kinds={["text", "composition"]}
				onPlace={() => undefined}
			/>,
		),
	);
}

test("loading and empty Motion states differ", async () => {
	let finish!: (items: ClipTemplate[]) => void;
	load.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render();
	expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading saved motion");
	expect(host.textContent).not.toContain("No saved motion yet");
	await act(async () => finish([]));
	expect(host.querySelector('[role="status"]')).toBeNull();
	expect(host.textContent).toContain("No saved motion yet");
});

test("request failure is not shown as empty Motion", async () => {
	load.mockRejectedValue(new Error("offline"));
	await render();
	expect(host.querySelector('[role="alert"]')?.textContent).toContain("Failed to load");
	expect(host.textContent).not.toContain("No saved motion yet");
});

test("Motion contains saved compositions, not primitive variants", async () => {
	load.mockResolvedValue([
		{
			id: "shape",
			kind: "text",
			base: "shape-star",
			category: "shape",
			label: "Variant",
			intent: "",
			config: {},
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: "motion",
			kind: "composition",
			base: "composition",
			category: "motion",
			label: "User motion",
			intent: "",
			config: {
				schemaVersion: 1,
				spanSec: 3,
				overlays: [{ preset: "shape-star", content: "", relStart: 0, dur: 3 }],
			},
			createdAt: 1,
			updatedAt: 1,
		},
	]);
	await render();
	expect(host.querySelector('[aria-label="Add User motion"]')).not.toBeNull();
	expect(host.querySelector('[aria-label="Add Variant"]')).toBeNull();
});
