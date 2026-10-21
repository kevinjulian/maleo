import { expect, test } from "vite-plus/test";
import { visualBoxHeight } from "./AnimatedVisual";

test("a flipped, cropped, masked or colored visual without a height still gets a sized box", () => {
	expect(visualBoxHeight({ widthPct: 50, flipX: true })).toBe("100%");
	expect(
		visualBoxHeight({
			widthPct: 50,
			mask: {
				shape: "ellipse",
				xPct: 0,
				yPct: 0,
				widthPct: 100,
				heightPct: 100,
				rotationDeg: 0,
				featherPct: 0,
				inverted: false,
			},
		}),
	).toBe("100%");
	expect(
		visualBoxHeight({ widthPct: 50, color: { brightness: 1.2, contrast: 1, saturation: 1 } }),
	).toBe("100%");
});

test("legacy unwrapped visuals keep their natural auto height, and explicit heights win", () => {
	expect(visualBoxHeight({ widthPct: 50 })).toBe("auto");
	expect(
		visualBoxHeight({ widthPct: 50, color: { brightness: 1, contrast: 1, saturation: 1 } }),
	).toBe("auto");
	expect(visualBoxHeight({ widthPct: 50, heightPct: 40, flipX: true })).toBe("40%");
	expect(visualBoxHeight(undefined)).toBe("auto");
});
