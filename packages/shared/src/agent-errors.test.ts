import { describe, expect, test } from "vite-plus/test";
import { classifyAgentError } from "./agent-errors.ts";

describe("classifyAgentError", () => {
	test("turns codex exit 143 into a retryable timeout message", () => {
		const info = classifyAgentError(
			"Video planning failed: codex failed (exit 143): use max 7-word text",
		);
		expect(info.kind).toBe("timeout");
		expect(info.title).toBe("Planning timed out");
		expect(info.retryable).toBe(true);
		expect(info.message).toContain("Project is saved");
		expect(info.technicalDetail).toContain("exit 143");
	});

	test("keeps unknown raw detail collapsed, not as main message", () => {
		const info = classifyAgentError("unexpected provider crash");
		expect(info.kind).toBe("unknown");
		expect(info.message).not.toContain("unexpected provider crash");
		expect(info.technicalDetail).toBe("unexpected provider crash");
	});
});
