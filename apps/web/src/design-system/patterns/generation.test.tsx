import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationCard, GenerationError, GenerationProgress } from "./generation.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe("GenerationProgress", () => {
	it("shows a bar only for a measure it was given, and only while running", () => {
		const count = { done: 1, total: 3, unit: "steps" };
		expect(html(<GenerationProgress label="Rewrite" running count={count} />)).toMatch(
			/<progress[^>]*value="1"[^>]*max="3"/,
		);
		expect(html(<GenerationProgress label="Working" running />)).not.toContain("<progress");
		expect(html(<GenerationProgress label="Done" count={count} />)).not.toContain("<progress");
	});

	it("writes the count out and never invents one", () => {
		expect(
			html(<GenerationProgress label="x" count={{ done: 2, total: 8, unit: "sections" }} />),
		).toContain("2/8 sections");
		expect(
			html(<GenerationProgress label="x" count={{ done: 0, total: 0, unit: "sections" }} />),
		).not.toContain('data-gen="count"');
	});

	it("offers an action only when it is given one", () => {
		expect(html(<GenerationProgress label="Failed" />)).not.toContain('data-gen="action"');
		expect(
			html(
				<GenerationProgress
					label="Failed"
					tone="error"
					action={<button type="button">Retry</button>}
				/>,
			),
		).toContain('data-gen="action"');
	});

	it("announces the stage only when asked, and never the count", () => {
		const out = html(
			<GenerationProgress
				label="Rewrite"
				running
				announce
				count={{ done: 1, total: 3, unit: "steps" }}
			/>,
		);
		expect(out).toMatch(/data-gen="stage"[^>]*role="status"[^>]*>Rewrite</);
		expect(out).not.toMatch(/data-gen="count"[^>]*role="status"/);
		expect(html(<GenerationProgress label="Done" />)).not.toContain('role="status"');
	});

	it("carries the tone as data, with the state always in words", () => {
		const out = html(<GenerationProgress label="Partly done" tone="warn" />);
		expect(out).toContain('data-tone="warn"');
		expect(out).toContain("Partly done");
	});
});

describe("GenerationCard", () => {
	it("identifies the run's phase, whether it is busy and whether it is the frontier", () => {
		const out = html(<GenerationCard phase="running" busy frontier status={<i />} />);
		expect(out).toContain('data-phase="running"');
		expect(out).toContain('aria-busy="true"');
		expect(out).toContain("data-frontier");
		expect(html(<GenerationCard phase="done" status={<i />} />)).not.toContain("data-frontier");
	});

	it("puts the status first and the run's content after it", () => {
		const out = html(
			<GenerationCard phase="done" status={<i id="status" />}>
				<i id="output" />
			</GenerationCard>,
		);
		expect(out.indexOf('id="status"')).toBeLessThan(out.indexOf('id="output"'));
	});
});

describe("GenerationError", () => {
	it("says what failed and why, with detail behind a disclosure", () => {
		const out = html(
			<GenerationError
				title="Provider refused"
				code="provider_400"
				message="Rephrase and retry."
				detail="request 7f3a"
			/>,
		);
		expect(out).toContain("Provider refused");
		expect(out).toContain("provider_400");
		expect(out).toMatch(/<details><summary>Details<\/summary><pre>request 7f3a<\/pre><\/details>/);
	});

	it("has no disclosure without detail and no action of its own", () => {
		const out = html(<GenerationError title="Failed" message="Try again." />);
		expect(out).not.toContain("<details");
		expect(out).not.toContain("<button");
	});
});
