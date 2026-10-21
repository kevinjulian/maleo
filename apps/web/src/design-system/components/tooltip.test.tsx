import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./icon-button.tsx";
import { Tooltip } from "./tooltip.tsx";

describe("Tooltip", () => {
	it("renders its child as the trigger and leaves the child's name alone", () => {
		const out = renderToStaticMarkup(
			<Tooltip label="Split at playhead">
				<IconButton aria-label="Split">x</IconButton>
			</Tooltip>,
		);
		expect(out).toContain('data-slot="icon-button"');
		expect(out).toContain('aria-label="Split"');
		expect(out.match(/<button/g)?.length).toBe(1);
	});

	it("adds no native title and renders no popup while closed", () => {
		const out = renderToStaticMarkup(
			<Tooltip label="Split at playhead">
				<IconButton aria-label="Split">x</IconButton>
			</Tooltip>,
		);
		expect(out).not.toContain("title=");
		expect(out).not.toContain("Split at playhead");
	});
});
