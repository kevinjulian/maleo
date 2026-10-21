import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaCard, MediaGrid } from "./media.tsx";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const img = <img src="/a.png" alt="" />;

describe("MediaGrid", () => {
	it("is a named list, not a grid role it has no keyboard model for", () => {
		const out = html(
			<MediaGrid label="Generated images" min={72} density="compact">
				x
			</MediaGrid>,
		);
		expect(out).toContain('role="list" aria-label="Generated images"');
		expect(out).not.toContain('role="grid"');
		expect(out).toContain("--ui-media-min:72px");
		expect(out).toContain('data-density="compact"');
	});
});

describe("MediaCard", () => {
	it("has one activation, and keeps other controls outside it", () => {
		const out = html(
			<MediaCard
				preview={img}
				title="Fixture"
				onActivate={() => {}}
				actions={
					<button type="button" id="menu">
						m
					</button>
				}
			/>,
		);
		expect(out.match(/<button/g)).toHaveLength(2);
		const main = out.slice(out.indexOf('class="ui-media-main"'), out.indexOf("</button>"));
		expect(main).not.toContain('id="menu"');
	});

	it("is not a button when it does nothing", () => {
		expect(html(<MediaCard preview={img} title="Fixture" />)).not.toContain("<button");
	});

	it("announces selection only when it is selectable", () => {
		expect(html(<MediaCard preview={img} selected onActivate={() => {}} />)).toContain(
			'aria-pressed="true"',
		);
		expect(html(<MediaCard preview={img} selected={false} onActivate={() => {}} />)).toContain(
			'aria-pressed="false"',
		);
		expect(html(<MediaCard preview={img} onActivate={() => {}} />)).not.toContain("aria-pressed");
	});

	it("says the preview is unavailable in its place, and keeps the item", () => {
		const out = html(<MediaCard preview={img} unavailable="Image unavailable" title="Fixture" />);
		expect(out).toContain("Image unavailable");
		expect(out).not.toContain("<img");
		expect(out).toContain("Fixture");
	});

	it("puts the title under the preview or over its foot", () => {
		expect(html(<MediaCard preview={img} title="T" meta="M" />)).toContain("ui-media-copy");
		const over = html(<MediaCard preview={img} title="T" caption="overlay" />);
		expect(over).toContain("ui-media-caption");
		expect(over).not.toContain("ui-media-copy");
	});

	it("compact pickers keep an accessible activation and omit visible card copy", () => {
		const out = html(
			<MediaCard
				variant="picker"
				preview={img}
				title="Text"
				meta="Basic"
				label="Add Text"
				hint="Text"
				onActivate={() => {}}
			/>,
		);
		expect(out).toContain('aria-label="Add Text"');
		expect(out.match(/<button/g)).toHaveLength(1);
		expect(out).not.toContain("ui-media-copy");
		expect(out).not.toContain("ui-media-caption");
	});

	it("passes drag and pointer handlers to the card", () => {
		expect(html(<MediaCard preview={img} draggable hint="Drag onto the timeline" />)).toMatch(
			/<li[^>]*title="Drag onto the timeline"[^>]*draggable="true"/,
		);
	});
});
