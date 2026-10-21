import { describe, expect, test } from "vite-plus/test";
import { MCP_KEY_PLACEHOLDER, mcpClientGuides } from "./mcp-clients.ts";

const ENDPOINT = "https://maleo.example/api/mcp";

describe("MCP client guides", () => {
	test("every client points at the endpoint and, until a key exists, carries the placeholder", () => {
		const guides = mcpClientGuides(ENDPOINT, null);
		expect(guides.map((guide) => guide.label)).toEqual([
			"Codex CLI",
			"Claude Code",
			"Cursor",
			"VS Code",
			"Other",
		]);
		for (const guide of guides) expect(guide.snippet).toContain(ENDPOINT);
		for (const guide of guides.filter((guide) => guide.id !== "other"))
			expect(guide.snippet).toContain(MCP_KEY_PLACEHOLDER);
	});

	test("with a key just created, the snippets carry it, ready to paste", () => {
		const guides = mcpClientGuides(ENDPOINT, "maleo_secret123");
		expect(guides.find((guide) => guide.id === "claude-code")?.snippet).toBe(
			`claude mcp add --transport http maleo ${ENDPOINT} \\\n  --header "Authorization: Bearer maleo_secret123"`,
		);
		expect(guides.find((guide) => guide.id === "codex")?.snippet).toContain(
			'export MALEO_MCP_KEY="maleo_secret123"',
		);
		expect(JSON.parse(guides.find((guide) => guide.id === "cursor")!.snippet)).toEqual({
			mcpServers: {
				maleo: { url: ENDPOINT, headers: { Authorization: "Bearer maleo_secret123" } },
			},
		});
		expect(guides.some((guide) => guide.snippet.includes(MCP_KEY_PLACEHOLDER))).toBe(false);
	});
});
