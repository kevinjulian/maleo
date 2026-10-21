import { describe, expect, test } from "vite-plus/test";
import {
	CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS,
	CLIENT_VISUAL_REVEAL_COLOR_BUILDS,
	CLIENT_VISUAL_REVEAL_PHASES,
	CLIENT_VISUAL_REVEAL_TEXTURES,
	DEFAULT_VISUAL_REVEAL,
	VISUAL_REVEAL_BLACK_DIRECTION_LABEL,
	VISUAL_REVEAL_COLOR_BUILD_LABEL,
	VISUAL_REVEAL_PHASE_LABEL,
	VISUAL_REVEAL_TEXTURE_LABEL,
	clampRevealDurationSec,
	setRevealDurationMode,
} from "./timeline-editor-model";

describe("visual reveal editor model", () => {
	test("manual reveal duration clamps to current clip duration", () => {
		expect(clampRevealDurationSec(9, 3.5)).toBe(3.5);
		expect(clampRevealDurationSec(-2, 3.5)).toBe(0.1);
	});

	test("Auto duration is stored by omitting durationSec", () => {
		const manual = setRevealDurationMode(DEFAULT_VISUAL_REVEAL, "manual", 4);
		expect(manual.durationSec).toBe(4);
		expect(setRevealDurationMode(manual, "auto", 4)).toEqual(DEFAULT_VISUAL_REVEAL);
	});

	test("dark pixels first phase is offered", () => {
		expect(CLIENT_VISUAL_REVEAL_PHASES).toContain("dark_pixels_first");
		expect(CLIENT_VISUAL_REVEAL_PHASES).toContain("black_then_color");
		expect(VISUAL_REVEAL_PHASE_LABEL.dark_pixels_first).toBe("Dark pixels first");
		expect(VISUAL_REVEAL_PHASE_LABEL.black_then_color).toBe("Black, then color");
		expect(DEFAULT_VISUAL_REVEAL.phase).toBe("dark_pixels_first");
		expect(DEFAULT_VISUAL_REVEAL.direction).toBe("top_left_to_bottom_right");
	});

	test("reveal enhancement options are offered", () => {
		expect(CLIENT_VISUAL_REVEAL_TEXTURES).toEqual(["clean", "paper", "ink", "dust", "glitch"]);
		expect(VISUAL_REVEAL_TEXTURE_LABEL.paper).toBe("Paper");
		expect(CLIENT_VISUAL_REVEAL_COLOR_BUILDS).toEqual(["none", "muted_to_full"]);
		expect(VISUAL_REVEAL_COLOR_BUILD_LABEL.muted_to_full).toBe("Muted to full");
		expect(CLIENT_VISUAL_REVEAL_BLACK_DIRECTIONS).toEqual([
			"none",
			"left",
			"right",
			"top",
			"bottom",
		]);
		expect(VISUAL_REVEAL_BLACK_DIRECTION_LABEL.none).toBe("None");
		expect(VISUAL_REVEAL_BLACK_DIRECTION_LABEL.right).toBe("Right to left");
	});
});
