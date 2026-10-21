import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkReleaseTree, checkProductIdentity } from "./check-release-hygiene.ts";

const roots: string[] = [];

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "maleo-release-"));
	roots.push(root);
	for (const file of ["LICENSE", "PRIVACY.md", "CONTRIBUTING.md"])
		writeFileSync(join(root, file), "policy\n");
	writeFileSync(
		join(root, "THIRD_PARTY_NOTICES.md"),
		"Remotion Kokoro-82M Space Grotesk JetBrains Mono Pexels Freesound visual/baselines\n",
	);
	writeFileSync(join(root, "package.json"), '{"license":"MIT"}\n');
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("release hygiene", () => {
	test("binary asset names also use current product identity", () => {
		const root = fixture();
		writeFileSync(join(root, "aincer.png"), Buffer.from([0, 1, 2]));
		expect(checkProductIdentity(root, ["aincer.png"])).toEqual([
			{
				file: "aincer.png",
				rule: "product-identity",
				message: "former product name in active filename",
			},
		]);
	});
	test("migration exceptions cannot exempt adjacent runtime files or emitted JavaScript", () => {
		const root = fixture();
		mkdirSync(join(root, "scripts"));
		mkdirSync(join(root, "dist"));
		writeFileSync(join(root, "scripts/rebrand-state.ts"), 'const input = "AINCER_";');
		writeFileSync(join(root, "scripts/runtime.ts"), 'const value = "AINCER_KEY";');
		writeFileSync(join(root, "dist/app.js"), 'const name = "aincer";');
		const findings = checkProductIdentity(root, [
			"scripts/rebrand-state.ts",
			"scripts/runtime.ts",
			"dist/app.js",
		]);
		expect(findings.map((item) => item.file)).toEqual(["scripts/runtime.ts", "dist/app.js"]);
	});

	test("historical records stay readable while current requirements are checked", () => {
		const root = fixture();
		mkdirSync(join(root, "openspec/specs/identity"), { recursive: true });
		writeFileSync(join(root, "openspec/specs/identity/spec.md"), "aincer");
		writeFileSync(join(root, "CHANGELOG.md"), "## [Unreleased]\nMaleo\n## [0.1.0]\naincer\n");
		expect(
			checkProductIdentity(root, ["openspec/specs/identity/spec.md", "CHANGELOG.md"]).map(
				(item) => item.file,
			),
		).toEqual(["openspec/specs/identity/spec.md"]);
	});
	test("passes clean tree", () => expect(checkReleaseTree(fixture())).toEqual([]));

	test("reports missing policy and manifest license", () => {
		const root = fixture();
		rmSync(join(root, "PRIVACY.md"));
		writeFileSync(join(root, "package.json"), "{}\n");
		const findings = checkReleaseTree(root);
		expect(
			findings.some((item) => item.rule === "required-policy" && item.file === "PRIVACY.md"),
		).toBe(true);
		expect(
			findings.some((item) => item.rule === "manifest-license" && item.file === "package.json"),
		).toBe(true);
	});

	test("reports banned path and private fixture value", () => {
		const root = fixture();
		mkdirSync(join(root, ".beads"));
		mkdirSync(join(root, "packages/affiliate"), { recursive: true });
		writeFileSync(join(root, "fixture.json"), '{"email":"owner@gmail.com"}\n');
		const findings = checkReleaseTree(root);
		expect(findings.some((item) => item.rule === "banned-path" && item.file === ".beads")).toBe(
			true,
		);
		expect(
			findings.some((item) => item.rule === "banned-path" && item.file === "packages/affiliate"),
		).toBe(true);
		expect(
			findings.some((item) => item.rule === "private-value" && item.file === "fixture.json"),
		).toBe(true);
	});

	test("reports banned identifier and missing notice coverage", () => {
		const root = fixture();
		writeFileSync(join(root, "README.md"), "Use Focal and Supertonic.\n");
		writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "Pexels\n");
		const findings = checkReleaseTree(root);
		expect(
			findings.some((item) => item.rule === "banned-identifier" && item.file === "README.md"),
		).toBe(true);
		expect(
			findings.some((item) => item.rule === "notice-coverage" && item.message.includes("Remotion")),
		).toBe(true);
	});
});
