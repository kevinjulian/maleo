import { describe, expect, test } from "vite-plus/test";
import { join } from "node:path";
import { checkFile, isLiveGuidance, checksConcepts } from "./check-references";

const ROOT = join(import.meta.dirname, "..");
const DOC = join(ROOT, "docs", "example.md");
const README = join(ROOT, "packages", "core", "README.md");
const CODEMAP = join(ROOT, "docs", "CODEMAPS", "backend.md");

describe("isLiveGuidance", () => {
	test("includes root and docs guidance", () => {
		expect(isLiveGuidance("README.md")).toBe(true);
		expect(isLiveGuidance("AGENTS.md")).toBe(true);
		expect(isLiveGuidance("docs/CODEMAPS/backend.md")).toBe(true);
		expect(isLiveGuidance("apps/api/AGENTS.md")).toBe(true);
		expect(isLiveGuidance("apps/api/README.md")).toBe(true);
	});

	test("excludes the trees that describe the past on purpose", () => {
		expect(isLiveGuidance("docs/decisions/0001-inngest-durable-workflows.md")).toBe(false);
		expect(isLiveGuidance("docs/decisions/history/0001-implementation-log.md")).toBe(false);
		expect(isLiveGuidance("openspec/specs/workspace-package-pruning/spec.md")).toBe(false);
	});
});

describe("checkFile", () => {
	test("passes clean content", () => {
		const findings = checkFile(ROOT, DOC, "See `apps/api` for the server.\n");
		expect(findings).toEqual([]);
	});

	test("flags a package removed in the pivot", () => {
		const findings = checkFile(ROOT, DOC, "The server lives in `packages/dashboard`.\n");
		expect(findings).toHaveLength(1);
		expect(findings[0]!.reason).toContain("packages/dashboard");
	});

	test("allows naming a removed package when saying it is gone", () => {
		const findings = checkFile(ROOT, DOC, "The legacy `packages/dashboard` was removed.\n");
		expect(findings).toEqual([]);
	});

	test("flags a workspace path that does not exist", () => {
		const findings = checkFile(ROOT, DOC, "See `apps/api/src/does-not-exist.ts`.\n");
		expect(findings).toHaveLength(1);
		expect(findings[0]!.reason).toBe("workspace path does not exist");
	});

	test("accepts a workspace path that does exist", () => {
		const findings = checkFile(ROOT, DOC, "See `scripts/check-version.ts`.\n");
		expect(findings).toEqual([]);
	});

	test("flags a broken relative link", () => {
		const findings = checkFile(ROOT, DOC, "[gone](./nope-does-not-exist.md)\n");
		expect(findings).toHaveLength(1);
		expect(findings[0]!.reason).toContain("link target does not exist");
	});

	test("ignores external links and anchors", () => {
		const findings = checkFile(ROOT, DOC, "[bun](https://bun.sh) and [section](#data-model)\n");
		expect(findings).toEqual([]);
	});

	test("ignores content inside fenced code blocks", () => {
		const content = ["```bash", "cd packages/dashboard && bun run dev", "```", ""].join("\n");
		expect(checkFile(ROOT, DOC, content)).toEqual([]);
	});

	test("ignores gitignored .env paths", () => {
		expect(checkFile(ROOT, DOC, "Copy `packages/video/.env` first.\n")).toEqual([]);
	});

	test("resolves a bare scripts path against the owning package", () => {
		const inPackage = join(ROOT, "packages", "video", "AGENTS.md");
		const findings = checkFile(ROOT, inPackage, "Run `scripts/render-all.ts`.\n");
		// Resolves relative to packages/video, so it is only flagged if truly absent.
		for (const f of findings) expect(f.reason).toBe("workspace path does not exist");
	});

	test("reports the line number of a finding", () => {
		const findings = checkFile(ROOT, DOC, "clean line\nuses `packages/image` here\n");
		expect(findings[0]!.line).toBe(2);
	});
});

describe("checksConcepts", () => {
	test("applies to the docs that say what the product is", () => {
		expect(checksConcepts("packages/db/AGENTS.md")).toBe(true);
		expect(checksConcepts("AGENTS.md")).toBe(true);
		expect(checksConcepts("apps/api/AGENTS.md")).toBe(true);
	});

	test("does not apply to codemaps or decision records", () => {
		expect(checksConcepts("docs/CODEMAPS/backend.md")).toBe(false);
		expect(checksConcepts("docs/decisions/0003-reference-entity-model.md")).toBe(false);
		expect(checksConcepts("CONTRIBUTING.md")).toBe(false);
	});
});

describe("removed concepts", () => {
	test("flags a README that presents a removed concept as current", () => {
		const findings = checkFile(ROOT, README, "Configure AI personas that think and post.\n");
		expect(findings).toHaveLength(1);
		expect(findings[0]!.reason).toContain("persona");
	});

	test("names the replacement so the message says what to write instead", () => {
		const findings = checkFile(ROOT, README, "Each persona has its own catalog.\n");
		expect(findings[0]!.reason).toContain("workspace");
	});

	test("allows a line that says the concept is gone", () => {
		const findings = checkFile(ROOT, README, "The persona model was removed in the pivot.\n");
		expect(findings).toEqual([]);
	});

	test("does not flag a codemap describing mechanism", () => {
		const findings = checkFile(ROOT, CODEMAP, "The persona column is dropped by a migration.\n");
		expect(findings).toEqual([]);
	});

	test("respects word boundaries", () => {
		// "personal care" and "fleeting" must not trip the persona/fleet entries.
		expect(checkFile(ROOT, README, "Matches personal care products.\n")).toEqual([]);
		expect(checkFile(ROOT, README, "A fleeting cache entry.\n")).toEqual([]);
	});

	test("matches the plural form", () => {
		const findings = checkFile(ROOT, README, "Serves persona-scoped queries.\n");
		expect(findings).toHaveLength(1);
	});

	test("would have caught the three READMEs this change fixes", () => {
		const originals = [
			"Autonomous persona engine. Configure AI personas that think, post, learn, and reply across platforms.",
			"Central product-catalog service. Holds products and serves persona-scoped queries to maleo instances.",
			"- Default-personas auto-assignment (e.g. all new products to veronika)",
		];
		for (const line of originals) {
			expect(checkFile(ROOT, README, `${line}\n`).length).toBeGreaterThan(0);
		}
	});
});

describe("widened scope and wrapped prose", () => {
	test("package doc trees are now gated", () => {
		expect(isLiveGuidance("apps/api/docs/API.md")).toBe(true);
		expect(isLiveGuidance("packages/video/docs/RUNBOOK.md")).toBe(true);
		expect(isLiveGuidance("apps/web/AGENTS.md")).toBe(true);
	});

	test("history trees stay exempt", () => {
		expect(isLiveGuidance("docs/decisions/README.md")).toBe(false);
		expect(isLiveGuidance("openspec/specs/open-source-workflow/spec.md")).toBe(false);
	});

	test("an exemption word on the next line still exempts the sentence", () => {
		// Prose wraps; the word that makes this correct is not on the match line.
		const wrapped = "It described the persona engine that the\nworkspace pivot removed.\n";
		expect(checkFile(ROOT, README, wrapped)).toEqual([]);
	});

	test("an exemption word on the previous line still exempts", () => {
		const wrapped = "That subject was removed, so nothing\ndocuments the persona model now.\n";
		expect(checkFile(ROOT, README, wrapped)).toEqual([]);
	});

	test("a genuinely current claim two lines from an exemption still fails", () => {
		const content = "The pivot removed a lot.\n\n\nConfigure AI personas that post.\n";
		expect(checkFile(ROOT, README, content).length).toBeGreaterThan(0);
	});
});
