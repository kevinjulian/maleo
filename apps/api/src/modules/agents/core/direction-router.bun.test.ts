import { afterEach, describe, expect, test } from "bun:test";
import { routeDirection, setDirectionRouterForTests } from "../../../lib/content-generator.ts";

afterEach(() => setDirectionRouterForTests(null));

describe("routeDirection", () => {
	test("empty input yields empty channels (no LLM call)", async () => {
		expect(await routeDirection("   ")).toEqual({ story: "", visual: "", voice: "", rules: "" });
	});

	test("uses the router override to split channels", async () => {
		setDirectionRouterForTests(async (raw) => ({
			story: "contentment theme",
			visual: raw.includes("stickman") ? "stickman, white bg" : "",
			voice: "warm slow female",
			rules: raw.includes("no humans") ? "no humans on screen" : "",
		}));
		const out = await routeDirection(
			"calm, stickman white bg, no humans, warm slow female narrator",
		);
		expect(out.story).toBe("contentment theme");
		expect(out.visual).toBe("stickman, white bg");
		expect(out.voice).toBe("warm slow female");
		// A prohibition is a constraint, not visual taste — it must not land in visual.
		expect(out.rules).toBe("no humans on screen");
	});
});
