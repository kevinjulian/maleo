import { describe, expect, test } from "vite-plus/test";
import { checkVersions, parseChangelogVersion, parsePackageVersion } from "./check-version";

describe("parseChangelogVersion", () => {
	test("skips Unreleased and returns the newest released heading", () => {
		const changelog = [
			"# Changelog",
			"",
			"## [Unreleased]",
			"",
			"### Added",
			"- something",
			"",
			"## [0.2.0] - 2026-08-20",
			"",
			"## [0.1.0] - 2026-08-01",
		].join("\n");
		expect(parseChangelogVersion(changelog)).toBe("0.2.0");
	});

	test("returns undefined when nothing has been released yet", () => {
		expect(parseChangelogVersion("# Changelog\n\n## [Unreleased]\n")).toBeUndefined();
	});
});

describe("parsePackageVersion", () => {
	test("reads the version field", () => {
		expect(parsePackageVersion('{"name":"x","version":"1.2.3"}')).toBe("1.2.3");
	});

	test("returns undefined when absent", () => {
		expect(parsePackageVersion('{"name":"x"}')).toBeUndefined();
	});
});

describe("checkVersions", () => {
	test("passes when package and changelog agree", () => {
		const result = checkVersions({ packageVersion: "0.1.0", changelogVersion: "0.1.0" });
		expect(result).toEqual({ ok: true, version: "0.1.0" });
	});

	test("passes when a matching tag is present, with or without the v prefix", () => {
		for (const tag of ["v0.1.0", "0.1.0"]) {
			const result = checkVersions({
				packageVersion: "0.1.0",
				changelogVersion: "0.1.0",
				tag,
			});
			expect(result.ok).toBe(true);
		}
	});

	test("fails when the changelog lags the package version", () => {
		const result = checkVersions({ packageVersion: "0.2.0", changelogVersion: "0.1.0" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("0.2.0");
		expect(result.message).toContain("0.1.0");
	});

	test("fails when the release tag disagrees", () => {
		const result = checkVersions({
			packageVersion: "0.1.0",
			changelogVersion: "0.1.0",
			tag: "v0.9.9",
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("v0.9.9");
	});

	test("fails when the root package.json has no version", () => {
		const result = checkVersions({ packageVersion: undefined, changelogVersion: "0.1.0" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("no version field");
	});

	test("fails when nothing has been released", () => {
		const result = checkVersions({ packageVersion: "0.1.0", changelogVersion: undefined });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("no released version heading");
	});

	test("fails on a non-semver version", () => {
		const result = checkVersions({ packageVersion: "latest", changelogVersion: "latest" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.message).toContain("not a semver version");
	});
});
