import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { Slider, sliderFill } from "./slider.tsx";

describe("Slider", () => {
	it("stays a native range input, so keyboard and form behaviour are the browser's", () => {
		const html = renderToStaticMarkup(
			<Slider aria-label="Opacity" min={0} max={100} value={50} onChange={() => {}} />,
		);
		expect(html).toContain('type="range"');
		expect(html).toContain('aria-label="Opacity"');
		expect(html).toContain("--ui-slider-fill:50%");
	});

	it("fills by position in the range, clamped", () => {
		expect(sliderFill(25, 0, 100)).toBe("25%");
		expect(sliderFill(0, -180, 180)).toBe("50%");
		expect(sliderFill(500, 0, 100)).toBe("100%");
		expect(sliderFill(-5, 0, 100)).toBe("0%");
		expect(sliderFill(1, 1, 1)).toBe("0%");
	});
});
