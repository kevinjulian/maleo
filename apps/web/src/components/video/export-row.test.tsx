import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportRow } from "./export-row.tsx";
import { EXPORT_STATUSES } from "@models/video/export-filters.ts";
import type { Job } from "@models/video/render-job.ts";

const job = (over: Partial<Job>): Job => ({
	id: "j",
	preset: "wide",
	status: "done",
	progress: 0.5,
	created_at: 1,
	finished_at: null,
	output_path: null,
	error: "detail",
	project_title: "Long title ".repeat(50),
	...over,
});
const html = (j: Job): string => renderToStaticMarkup(<ExportRow job={j} onDetails={() => {}} />);

test("every attempt is one media row with identity, status and one action", () => {
	for (const status of EXPORT_STATUSES) {
		const out = html(job({ status }));
		expect(out).toContain('data-slot="media-card"');
		expect(out).toContain('data-layout="list"');
		expect(out).not.toContain('data-slot="generation-card"');
		expect(out).toContain("Long title");
		expect(out).toContain(status.replaceAll("_", " "));
		expect(out).toMatch(
			new RegExp(`aria-label="View export: [^"]*, ${status.replaceAll("_", " ")}, [^"]+"`),
		);
		expect(out.match(/<button/g)).toHaveLength(2);
	}
});

test("the preview says why there is nothing to see", () => {
	expect(html(job({ status: "done" }))).toContain("No preview");
	expect(html(job({ status: "queued" }))).toContain("Queued");
	expect(html(job({ status: "running" }))).toContain("Rendering");
	expect(html(job({ status: "error" }))).toContain("No output");
	expect(html(job({ status: "done", thumbnail_url: "/p.jpg" }))).toContain('src="/p.jpg"');
});

test("a running attempt measures progress; a finished one does not", () => {
	const running = html(job({ status: "running", phase: "rendering", progress: 0.42 }));
	expect(running).toContain('role="progressbar"');
	expect(running).toContain('aria-valuenow="42"');
	expect(html(job({ status: "queued" }))).not.toContain('role="progressbar"');
	expect(html(job({ status: "done" }))).not.toContain('role="progressbar"');
});

test("failed and degraded attempts state their cause in the row", () => {
	expect(html(job({ status: "error", error: "Renderer crashed" }))).toContain("Renderer crashed");
	expect(html(job({ status: "done_with_fallback", phase_detail: "Silent audio" }))).toContain(
		"Silent audio",
	);
});

test("playable output offers Play; anything else offers Details", () => {
	expect(html(job({ status: "done", output_url: "/out.mp4" }))).toContain("Play");
	expect(html(job({ status: "error" }))).toContain("Details");
});
