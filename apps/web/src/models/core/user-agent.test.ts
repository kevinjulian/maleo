import { describe, expect, test } from "vite-plus/test";
import { describeAgent } from "./user-agent.ts";

describe("describeAgent", () => {
	test("names common browser and system pairs", () => {
		expect(
			describeAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
			),
		).toBe("Chrome on macOS");
		expect(
			describeAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
			),
		).toBe("Edge on Windows");
		expect(
			describeAgent(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("Safari on iOS");
		expect(
			describeAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"),
		).toBe("Firefox on Linux");
	});

	test("an absent agent and an unknown one", () => {
		expect(describeAgent(null)).toBe("Unknown device");
		expect(describeAgent("curl/8.4.0")).toBe("curl/8.4.0");
		expect(describeAgent("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
	});
});
