#!/usr/bin/env bun
/**
 * Version consistency gate.
 *
 * One canonical version lives in the root package.json. It must agree with the
 * newest released heading in CHANGELOG.md, and — when the check runs on a
 * release tag — with that tag.
 *
 * Workspace packages under packages/* and apps/* are deliberately ignored: they
 * are all private and are never published independently, so their version
 * fields carry no meaning.
 *
 * Runs in pull-request CI and again in the release workflow. See CONTRIBUTING.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type VersionSources = {
	/** version field of the root package.json */
	packageVersion: string | undefined;
	/** newest released `## [x.y.z]` heading in the changelog, ignoring Unreleased */
	changelogVersion: string | undefined;
	/** release tag being built, when there is one (e.g. "v0.1.0") */
	tag?: string | undefined;
};

export type CheckResult = { ok: true; version: string } | { ok: false; message: string };

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Newest released version heading, skipping `## [Unreleased]`. */
export function parseChangelogVersion(changelog: string): string | undefined {
	for (const line of changelog.split("\n")) {
		const match = /^##\s*\[([^\]]+)\]/.exec(line);
		if (!match) continue;
		const value = match[1]!.trim();
		if (value.toLowerCase() === "unreleased") continue;
		return value;
	}
	return undefined;
}

export function parsePackageVersion(packageJson: string): string | undefined {
	// SAFETY: JSON.parse returns `any`; the assertion only narrows it to the one
	// field this reads, and `version` stays `unknown` so it is checked below.
	const parsed = JSON.parse(packageJson) as { version?: unknown };
	return typeof parsed.version === "string" ? parsed.version : undefined;
}

/** Strip a leading `v` so `v0.1.0` and `0.1.0` compare equal. */
function normalizeTag(tag: string): string {
	return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function checkVersions(sources: VersionSources): CheckResult {
	const { packageVersion, changelogVersion } = sources;

	if (!packageVersion) {
		return { ok: false, message: "root package.json has no version field" };
	}
	if (!SEMVER.test(packageVersion)) {
		return {
			ok: false,
			message: `root package.json version "${packageVersion}" is not a semver version`,
		};
	}
	if (!changelogVersion) {
		return {
			ok: false,
			message:
				"CHANGELOG.md has no released version heading; expected a `## [x.y.z] - YYYY-MM-DD` section",
		};
	}
	if (changelogVersion !== packageVersion) {
		return {
			ok: false,
			message: [
				"version mismatch:",
				`  package.json   ${packageVersion}  (canonical)`,
				`  CHANGELOG.md   ${changelogVersion}`,
				"  -> bump both to the same version, newest changelog heading first",
			].join("\n"),
		};
	}

	const tag = sources.tag?.trim();
	if (tag) {
		const tagVersion = normalizeTag(tag);
		if (tagVersion !== packageVersion) {
			return {
				ok: false,
				message: [
					"version mismatch:",
					`  package.json   ${packageVersion}  (canonical)`,
					`  CHANGELOG.md   ${changelogVersion}`,
					`  release tag    ${tag}`,
					"  -> the tag must match the canonical version",
				].join("\n"),
			};
		}
	}

	return { ok: true, version: packageVersion };
}

function readSources(root: string): VersionSources {
	// GITHUB_REF_NAME is the tag name on a tag-triggered workflow run.
	const ref = process.env.GITHUB_REF_NAME;
	const isTagRun = process.env.GITHUB_REF?.startsWith("refs/tags/") ?? false;
	return {
		packageVersion: parsePackageVersion(readFileSync(join(root, "package.json"), "utf8")),
		changelogVersion: parseChangelogVersion(readFileSync(join(root, "CHANGELOG.md"), "utf8")),
		tag: isTagRun ? ref : undefined,
	};
}

if (import.meta.main) {
	const root = join(import.meta.dirname, "..");
	const result = checkVersions(readSources(root));
	if (!result.ok) {
		console.error(`check-version: ${result.message}`);
		process.exit(1);
	}
	console.log(`check-version: ok, version ${result.version}`);
}
