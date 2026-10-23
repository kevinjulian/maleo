#!/usr/bin/env bun
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

export interface ReleaseFinding {
	file: string;
	rule: string;
	message: string;
}

const REQUIRED = ["LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "CONTRIBUTING.md"];
const NOTICE_TERMS = [
	"Remotion",
	"Kokoro-82M",
	"Space Grotesk",
	"JetBrains Mono",
	"Pexels",
	"Freesound",
	"visual/baselines",
];
const BANNED_PATHS = [
	".beads",
	"apps/chrome-ext",
	"apps/chrome-ext-pixabay-music-download",
	"apps/supertonic-tts",
	"packages/affiliate",
	"apps/api/src/lib/affiliate-client.ts",
	"apps/api/src/routes/catalog.ts",
	"apps/web/src/api/product-catalog.ts",
	"packages/media/src/providers/supertonic",
];
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"data",
	"dist",
	"build",
	".output",
	"coverage",
	"archive",
]);
const TEXT_EXTENSIONS = new Set([
	".css",
	".html",
	".json",
	".md",
	".toml",
	".ts",
	".tsx",
	".yaml",
	".yml",
]);
const ASSET_EXTENSIONS = new Set([
	".gif",
	".jpeg",
	".jpg",
	".mov",
	".mp3",
	".mp4",
	".otf",
	".png",
	".svg",
	".ttf",
	".wav",
	".webp",
	".woff",
	".woff2",
]);
const LEGACY_ID_FILES = new Set([
	"packages/db/src/db/library-fixtures.ts",
	"packages/db/src/db/unified-schema.ts",
	"packages/db/tests/unit/global-settings-migration.bun.test.ts",
	"packages/db/tests/unit/library-fixtures.bun.test.ts",
	"packages/shared/src/content-preset-builtins.ts",
	"packages/shared/src/content-preset-builtins.test.ts",
]);

function extension(path: string): string {
	const index = path.lastIndexOf(".");
	return index < 0 ? "" : path.slice(index).toLowerCase();
}

function walk(root: string, dir = root, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const path = join(dir, entry);
		const rel = relative(root, path).replaceAll("\\", "/");
		if (rel === "docs/decisions" || rel.startsWith("openspec/")) continue;
		if (rel === "packages/video/public" || rel.startsWith("packages/video/public/")) continue;
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) continue;
		if (stat.isDirectory()) walk(root, path, files);
		else files.push(path);
	}
	return files;
}

function finding(file: string, rule: string, message: string): ReleaseFinding {
	return { file, rule, message };
}

export function checkReleaseTree(root: string, trackedFiles?: string[]): ReleaseFinding[] {
	const findings: ReleaseFinding[] = [];
	for (const file of REQUIRED)
		if (!existsSync(join(root, file)))
			findings.push(finding(file, "required-policy", "required release policy file is missing"));
	for (const path of BANNED_PATHS)
		if (existsSync(join(root, path)))
			findings.push(finding(path, "banned-path", "prohibited or private path remains"));

	const files = trackedFiles?.map((file) => join(root, file)).filter(existsSync) ?? walk(root);
	findings.push(
		...checkProductIdentity(
			root,
			files.map((path) => relative(root, path)),
		),
	);
	for (const path of files) {
		const rel = relative(root, path).replaceAll("\\", "/");
		if (
			rel === "package.json" ||
			(/^(apps|packages)\//.test(rel) && rel.endsWith("/package.json"))
		) {
			try {
				// SAFETY: JSON remains unknown except optional license field checked below.
				const value = JSON.parse(readFileSync(path, "utf8")) as { license?: unknown };
				if (value.license !== "MIT")
					findings.push(finding(rel, "manifest-license", 'license must be "MIT"'));
			} catch {
				findings.push(finding(rel, "manifest-license", "package manifest is not valid JSON"));
			}
		}

		if (!TEXT_EXTENSIONS.has(extension(rel))) continue;
		if (rel.startsWith("openspec/") || rel.startsWith("docs/decisions/")) continue;
		const content = readFileSync(path, "utf8");
		if (
			!LEGACY_ID_FILES.has(rel) &&
			!rel.startsWith("scripts/check-release-hygiene") &&
			!["CHANGELOG.md", "THIRD_PARTY_NOTICES.md"].includes(rel) &&
			/\b(?:supertonic|mrbeast|kurzgesagt|vox-documentary|affiliate_shopee|MALEO_AFFILIATE|AFFILIATE_API_TOKENS)\b/i.test(
				content,
			)
		) {
			findings.push(
				finding(
					rel,
					"banned-identifier",
					"restricted provider or brand identifier remains outside migration proof",
				),
			);
		}
		if (
			!rel.startsWith("scripts/check-release-hygiene") &&
			rel !== "CHANGELOG.md" &&
			/(?:susercontent|sayakeju|gmail\.com|herdr\.collie|kvnjln)/i.test(content)
		) {
			findings.push(
				finding(rel, "private-value", "captured service or maintainer-specific value remains"),
			);
		}
		if (rel.startsWith("scripts/check-release-hygiene")) continue;
		for (const match of content.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
			if (!match[0].toLowerCase().endsWith("@example.com"))
				findings.push(finding(rel, "private-email", "non-example email address remains"));
		}
	}

	const noticePath = join(root, "THIRD_PARTY_NOTICES.md");
	const notice = existsSync(noticePath) ? readFileSync(noticePath, "utf8") : "";
	for (const term of NOTICE_TERMS)
		if (!notice.includes(term))
			findings.push(
				finding("THIRD_PARTY_NOTICES.md", "notice-coverage", `missing notice coverage: ${term}`),
			);
	for (const path of files) {
		const rel = relative(root, path).replaceAll("\\", "/");
		/* Our own captures of our own output: visual regression baselines, the UI
		 * audit's evidence screenshots, and the caption spike's renders of the
		 * product's own captions. None is a third-party asset. */
		if (
			!ASSET_EXTENSIONS.has(extension(rel)) ||
			rel.startsWith("apps/web/visual/baselines/") ||
			rel.startsWith("docs/design-system/screenshots/") ||
			rel.startsWith("spikes/rust-captions/results/")
		)
			continue;
		if (!notice.includes(rel))
			findings.push(
				finding(rel, "asset-provenance", "tracked asset is not named in third-party inventory"),
			);
	}
	return findings;
}

export function checkProductIdentity(root: string, files: string[]): ReleaseFinding[] {
	const findings: ReleaseFinding[] = [];
	const exceptions = new Set([
		"scripts/rebrand-state.ts",
		"scripts/rebrand-state.bun.test.ts",
		"scripts/check-release-hygiene.ts",
		"scripts/check-release-hygiene.test.ts",
	]);
	for (const file of files) {
		const rel = file.replaceAll("\\", "/");
		if (
			exceptions.has(rel) ||
			rel.startsWith("openspec/changes/archive/") ||
			rel.startsWith("openspec/changes/rebrand-to-maleo/") ||
			rel.startsWith("docs/decisions/") ||
			rel.startsWith("data/")
		)
			continue;
		const path = join(root, file);
		if (!existsSync(path) || lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
			continue;
		if (/aincer/i.test(rel))
			findings.push(finding(rel, "product-identity", "former product name in active filename"));
		const bytes = readFileSync(path);
		if (bytes.includes(0)) continue;
		let content = bytes.toString("utf8");
		if (rel === "CHANGELOG.md")
			content = content.split(/^## /m).find((part) => part.startsWith("[Unreleased]")) ?? "";
		if (rel === "docs/self-hosting.md")
			content = content.replace(/## Maleo cutover\n[\s\S]*?(?=\n## |$)/, "");
		content = content.replace(
			/(?:openspec\/changes\/archive\/|docs\/decisions\/)[^\s)\]`"<>]+/g,
			"",
		);
		for (const [index, line] of content.split("\n").entries()) {
			if (/aincer/i.test(line))
				findings.push(finding(rel, "product-identity", `former product name at line ${index + 1}`));
		}
	}
	return findings;
}

if (import.meta.main) {
	const root = resolve(import.meta.dirname, "..");
	const listed = spawnSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root, encoding: "utf8" },
	);
	if (listed.status !== 0) {
		console.error("check-release-hygiene: cannot list tracked files");
		process.exit(1);
	}
	const tracked = listed.stdout.split("\0").filter(Boolean);
	const findings = checkReleaseTree(root, tracked);
	if (findings.length) {
		console.error(`check-release-hygiene: ${findings.length} finding(s)`);
		for (const item of findings) console.error(`  ${item.file} [${item.rule}] ${item.message}`);
		process.exit(1);
	}
	console.log("check-release-hygiene: ok");
}
