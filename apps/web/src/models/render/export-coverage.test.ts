import { describe, expect, it, vi } from "vite-plus/test";
import { coverageReason, createCoverageLoader } from "./export-coverage.ts";

const source = { storyboard: { scenes: [] }, fps: 30, frames: 60, width: 1080, height: 1920 };

function fakeModule(result: string) {
	return {
		default: vi.fn(async () => undefined),
		project_coverage: vi.fn(() => result),
	};
}

describe("export coverage", () => {
	it("loads the renderer module once and reports eligibility", async () => {
		const native = fakeModule("[]");
		const load = vi.fn(async () => native);
		const check = createCoverageLoader(load);
		expect(await check(source)).toEqual({ state: "eligible" });
		expect(await check(source)).toEqual({ state: "eligible" });
		expect(load).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith("/renderer/maleo_renderer_wasm.js");
		expect(native.default).toHaveBeenCalledTimes(1);
		expect(native.project_coverage).toHaveBeenCalledWith('{"scenes":[]}', 30, 60);
	});

	it("reports the first unsupported element with its time", async () => {
		const entry = {
			kind: "text",
			path: "textOverlays[0]",
			reason: "`lower-third` preset",
			frame: 45,
			time: 1.5,
		};
		const check = createCoverageLoader(async () =>
			fakeModule(JSON.stringify([entry, { ...entry, path: "x" }])),
		);
		const result = await check(source);
		expect(result).toEqual({ state: "ineligible", entries: [entry, { ...entry, path: "x" }] });
		expect(coverageReason(result.state === "ineligible" ? result.entries : [])).toBe(
			"`lower-third` preset at 1.50 s (+1 more)",
		);
	});

	it("reports a load failure and retries the load on the next check", async () => {
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error("404"))
			.mockResolvedValueOnce(fakeModule("[]"));
		const check = createCoverageLoader(load);
		expect(await check(source)).toEqual({ state: "error", message: "404" });
		expect(await check(source)).toEqual({ state: "eligible" });
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("refuses a malformed report instead of calling it eligible", async () => {
		const check = createCoverageLoader(async () => fakeModule('[{"kind":1}]'));
		expect((await check(source)).state).toBe("error");
	});
});
