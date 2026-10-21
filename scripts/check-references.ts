#!/usr/bin/env bun
/**
 * Stale-reference gate for live guidance docs.
 *
 * Two failure modes, both of which used to be caught only by someone noticing:
 *   1. a relative link or workspace path that no longer exists
 *   2. a package removed in the persona -> workspace pivot presented as current
 *
 * Scope is LIVE guidance only. Archived OpenSpec changes, planning notes, and
 * decision-record history are history: they are allowed to name what was true
 * when they were written, so they are skipped.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";

export type Finding = { file: string; line: number; text: string; reason: string };

/** Packages removed in the pivot. Naming one as a current surface is a bug. */
const REMOVED_PACKAGES = [
	"packages/dashboard",
	"packages/image",
	"packages/news",
	"packages/chatterbox",
	"@maleo/dashboard",
	"@maleo/image",
	"@maleo/news",
	"@maleo/chatterbox",
];

/**
 * Product concepts removed in the persona -> workspace pivot.
 *
 * A path either resolves or it does not, so the path check can run everywhere.
 * A concept is a word, and the same word is often correct in a codemap
 * describing a mechanism or an ADR describing why a road was taken. So concept
 * matching is scoped to README and AGENTS files — the documents that tell a
 * contributor what the product IS — and the vocabulary is deliberately small:
 * only concepts we can evidence, each with the replacement to write instead.
 */
export const REMOVED_CONCEPTS: ReadonlyArray<{ word: string; use: string }> = [
	{ word: "persona", use: "workspace" },
	{ word: "fleet", use: "no replacement; there is no multi-persona overview" },
];

/** Concept matching applies to the docs that describe what the product is. */
export function checksConcepts(rel: string): boolean {
	const base = rel.split("/").pop() ?? "";
	return base === "README.md" || base === "AGENTS.md";
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"archive", // openspec/changes/archive — historical by definition
	".planning",
	".beads",
	"history", // docs/decisions/history — preserved implementation logs
	"dist",
	"build",
	"out",
	"data",
	".claude",
	".codex",
	".agents",
	"test-results",
	"coverage",
]);

/** A path that looks like a repo path rather than prose. */
const WORKSPACE_PATH = /\b((?:packages|apps|scripts|docs|openspec)\/[A-Za-z0-9._/-]+)/g;
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

function isSkippable(target: string): boolean {
	return (
		target.startsWith("http") ||
		target.startsWith("#") ||
		target.startsWith("mailto:") ||
		target.includes("*") || // glob in an example
		target.startsWith("<") // placeholder like <name>
	);
}

/** Strip fenced code blocks — examples there name things that need not exist. */
function stripFences(content: string): string[] {
	const lines = content.split("\n");
	let inFence = false;
	return lines.map((line) => {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			return "";
		}
		return inFence ? "" : line;
	});
}

export function checkFile(root: string, file: string, content: string): Finding[] {
	const findings: Finding[] = [];
	const lines = stripFences(content);
	const rel = relative(root, file);

	lines.forEach((raw, index) => {
		const line = raw;
		if (!line.trim()) return;
		const lineNumber = index + 1;

		for (const removed of REMOVED_PACKAGES) {
			if (!line.includes(removed)) continue;
			// A line explaining that it is gone is exactly what we want to keep.
			if (
				/\b(removed|retired|gone|gitignored|legacy|gone|gone\.|no longer|gone;|pre-pivot|deleted|old)\b/i.test(
					line,
				)
			) {
				continue;
			}
			findings.push({
				file: rel,
				line: lineNumber,
				text: line.trim(),
				reason: `names removed package "${removed}" as a current surface`,
			});
		}

		if (checksConcepts(rel)) {
			/* Prose wraps, so the word that exempts a sentence often lands on the next
			 * line. Checking the line alone flagged "It described the persona engine
			 * that the / workspace pivot removed" — correct text, split mid-sentence.
			 * Look at the neighbours for the exemption, not just the match line. */
			const context = [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" ");
			for (const { word, use } of REMOVED_CONCEPTS) {
				// Word-boundary match so "personal care" and "fleeting" do not trip it.
				if (!new RegExp(`\\b${word}s?\\b`, "i").test(line)) continue;
				// A sentence explaining that the concept is gone is what we want to keep.
				if (
					/\b(removed|retired|gone|no longer|pre-pivot|deleted|legacy|former|used to)\b/i.test(
						context,
					)
				) {
					continue;
				}
				findings.push({
					file: rel,
					line: lineNumber,
					text: line.trim(),
					reason: `describes removed concept "${word}" as current — use ${use}`,
				});
			}
		}

		for (const match of line.matchAll(MARKDOWN_LINK)) {
			const target = match[1]!.split("#")[0]!.trim();
			if (!target || isSkippable(target)) continue;
			const resolved = resolve(dirname(file), target);
			if (!existsSync(resolved)) {
				findings.push({
					file: rel,
					line: lineNumber,
					text: match[0]!,
					reason: `link target does not exist: ${target}`,
				});
			}
		}

		for (const match of line.matchAll(WORKSPACE_PATH)) {
			const target = match[1]!.replace(/[.,;:)]+$/, "");
			if (target.includes("*") || target.includes("<")) continue;
			if (target.includes("/.env")) continue; // gitignored by design
			if (existsSync(join(root, target))) continue;
			// Inside a package, a bare `scripts/x.ts` means the package's own scripts.
			const pkg = /^((?:packages|apps)\/[^/]+)\//.exec(rel)?.[1];
			if (pkg && existsSync(join(root, pkg, target))) continue;
			// Only flag paths that look concrete: a file extension or a known dir root.
			const looksConcrete = /\.[a-z]{2,4}$/.test(target);
			if (!looksConcrete) continue;
			findings.push({
				file: rel,
				line: lineNumber,
				text: target,
				reason: "workspace path does not exist",
			});
		}
	});

	return findings;
}

/**
 * Live guidance only. Two trees describe the past on purpose and are excluded:
 *
 *   docs/decisions/   an ADR's Context names what existed when the road was
 *                     chosen; rewriting it would falsify the record
 *   openspec/         proposals and specs describe changes, including removals,
 *                     so they must be able to name what is being removed
 *
 * Package doc trees used to be excluded too, as known stale history. They are
 * gated now: an ungated tree beside a gated one is where the next drift lands,
 * and the 23 files that could not survive the gate were deleted rather than
 * carried.
 */
export function isLiveGuidance(rel: string): boolean {
	if (rel.startsWith("docs/decisions/")) return false;
	if (rel.startsWith("openspec/")) return false;
	return true;
}

export function collectDocs(root: string, dir = root, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") && entry !== ".github") continue;
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectDocs(root, full, acc);
		} else if (entry.endsWith(".md") && isLiveGuidance(relative(root, full))) {
			acc.push(full);
		}
	}
	return acc;
}

if (import.meta.main) {
	const root = resolve(import.meta.dirname, "..");
	const findings = collectDocs(root).flatMap((file) =>
		checkFile(root, file, readFileSync(file, "utf8")),
	);

	if (findings.length > 0) {
		console.error(`check-references: ${findings.length} stale reference(s)\n`);
		for (const f of findings) {
			console.error(`  ${f.file}:${f.line}  ${f.reason}`);
			console.error(`    ${f.text}`);
		}
		process.exit(1);
	}
	console.log("check-references: ok, no stale references in live guidance docs");
}
