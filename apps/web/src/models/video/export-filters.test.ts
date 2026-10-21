import { expect, test } from "vite-plus/test";
import { exportFilters, exportQuery } from "./export-filters.ts";
import { exportOutputAvailable, isJobActive } from "./render-job.ts";
test("URL filters survive reload and reject invalid status and page", () => {
	const filters = { search: "long project", project: "p", status: "running", offset: 60 };
	expect(exportFilters(`?${exportQuery(filters, "team")}`)).toEqual(filters);
	expect(exportFilters("?status=invalid&offset=-1")).toEqual({
		search: "",
		project: "",
		status: "",
		offset: 0,
	});
});
test("only completed attempts with actual output offer playback", () => {
	for (const status of [
		"queued",
		"running",
		"done",
		"done_with_fallback",
		"error",
		"cancelled",
	] as const) {
		expect(isJobActive({ status })).toBe(status === "queued" || status === "running");
		expect(exportOutputAvailable({ status, output_url: "/api/media/m" })).toBe(
			status === "done" || status === "done_with_fallback",
		);
		expect(exportOutputAvailable({ status })).toBe(false);
	}
});
