import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { TransportControls } from "./transport.tsx";

const html = (over: Partial<Parameters<typeof TransportControls>[0]> = {}): string =>
	renderToStaticMarkup(
		<TransportControls
			playing={false}
			onTogglePlay={() => {}}
			currentSec={4.5}
			durationSec={183}
			{...over}
		/>,
	);

describe("TransportControls", () => {
	it("names the control for what a press does", () => {
		expect(html()).toContain('aria-label="Play"');
		expect(html({ playing: true })).toContain('aria-label="Pause"');
		expect(html({ playing: true })).toContain('title="Pause (Space / K)"');
	});

	it("shows the playhead against the duration from the times it is given", () => {
		const out = html();
		expect(out).toContain('data-transport="timecode"');
		expect(out.replace(/<[^>]+>/g, "")).toContain("00:04:50 / 03:03:00");
	});

	it("keeps the caller's order around Play", () => {
		const out = html({ before: <i id="before" />, after: <i id="after" /> });
		const [b, p, a] = ['id="before"', 'data-transport="play"', 'id="after"'].map((s) =>
			out.indexOf(s),
		);
		expect(b).toBeGreaterThan(-1);
		expect(b! < p! && p! < a!).toBe(true);
	});

	it("says so when playback cannot start", () => {
		expect(html({ disabled: true })).toMatch(/data-transport="play"[^>]*disabled/);
	});
});
