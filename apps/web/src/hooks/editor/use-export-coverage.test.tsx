// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vite-plus/test";
import type { ExportCoverage, ExportSource } from "@models/render/export-coverage.ts";
import type { CoverageCheck } from "./use-export-coverage.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useExportCoverage } = await import("./use-export-coverage.ts");

const source: ExportSource = {
	storyboard: { scenes: [] },
	fps: 30,
	frames: 30,
	width: 1080,
	height: 1920,
};

function mount(check: CoverageCheck, read: () => ExportSource | null = () => source) {
	let current: ExportCoverage | null = null;
	function Probe({ open }: { open: boolean }) {
		current = useExportCoverage(open, read, check);
		return null;
	}
	const root = createRoot(document.createElement("div"));
	const render = async (open: boolean): Promise<void> => {
		await act(async () => root.render(createElement(Probe, { open })));
	};
	return { render, value: () => current, unmount: () => act(() => root.unmount()) };
}

describe("useExportCoverage", () => {
	test("checks nothing until the menu opens, then checks the current storyboard", async () => {
		const check = vi.fn(async (): Promise<ExportCoverage> => ({ state: "eligible" }));
		const probe = mount(check);
		await probe.render(false);
		expect(check).not.toHaveBeenCalled();
		expect(probe.value()).toBeNull();
		await probe.render(true);
		expect(check).toHaveBeenCalledWith(source);
		expect(probe.value()).toEqual({ state: "eligible" });
		probe.unmount();
	});

	test("drops a result from an earlier opening", async () => {
		let resolveFirst: (value: ExportCoverage) => void = () => undefined;
		const check = vi
			.fn<CoverageCheck>()
			.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
			.mockImplementationOnce(async () => ({ state: "eligible" }));
		const probe = mount(check);
		await probe.render(true);
		expect(probe.value()).toEqual({ state: "checking" });
		await probe.render(false);
		await probe.render(true);
		expect(probe.value()).toEqual({ state: "eligible" });
		await act(async () => resolveFirst({ state: "ineligible", entries: [] }));
		expect(probe.value()).toEqual({ state: "eligible" });
		probe.unmount();
	});

	test("reports an unready preview without loading the renderer", async () => {
		const check = vi.fn<CoverageCheck>();
		const probe = mount(check, () => null);
		await probe.render(true);
		expect(probe.value()?.state).toBe("error");
		expect(check).not.toHaveBeenCalled();
		probe.unmount();
	});
});
