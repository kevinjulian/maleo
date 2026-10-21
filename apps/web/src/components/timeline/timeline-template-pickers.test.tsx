import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { StockSfxPicker, TIMELINE_TITLE_CHOICES } from "./timeline-template-pickers.tsx";
import { StockAudioResults } from "@components/timeline/media/stock-browser.tsx";
import { AccordionSection } from "./clip-canvas.tsx";

describe("timeline template selection pickers", () => {
	test("offers every supported section-title preset plus none", () => {
		expect(TIMELINE_TITLE_CHOICES.map((choice) => choice.value)).toEqual([
			"",
			"chapter",
			"cinematic-title-intro",
			"section-card",
			"countdown-intro",
		]);
	});

	test("reuses playable stock audio rows for SFX selection", () => {
		const html = renderToStaticMarkup(
			<StockAudioResults
				items={[
					{
						id: "fx-1",
						thumb: "",
						url: "https://stock.test/tick.mp3",
						kind: "audio",
						title: "Gentle tick",
						author: "Freesound",
						dur: 0.8,
					},
				]}
				onSelect={() => undefined}
			/>,
		);
		expect(html).toContain("Gentle tick");
		expect(html).toContain("Freesound");
		expect(html).toContain("Select");
		// The url is no longer an attribute: previews play through one shared
		// element, so the row carries a control named for its clip instead. What a
		// static render can still show is that the row is playable and is labelled
		// for the right sound.
		expect(html).toContain("Play Gentle tick");
	});

	test("keeps the selected SFX audible in the template editor", () => {
		const html = renderToStaticMarkup(
			<StockSfxPicker
				label="Section entry SFX"
				value="Gentle tick"
				audio={{ url: "https://stock.test/selected-tick.mp3", title: "Gentle tick" }}
				onChange={() => undefined}
			/>,
		);
		expect(html).toContain("Play Section entry SFX");
		expect(html).toContain("Seek Section entry SFX");
	});

	test("accordion headers expose expanded state and controlled panel", () => {
		const html = renderToStaticMarkup(
			<AccordionSection label="Opening" defaultOpen>
				<span>Settings</span>
			</AccordionSection>,
		);
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("aria-controls=");
		expect(html).toContain("Settings");
	});
});
