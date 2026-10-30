#!/usr/bin/env bun
/* Renders the Remotion reference frames of the Rust renderer's golden corpus
 * (crates/renderer/corpus, OpenSpec p2-render-foundation D6).
 *
 * Each case's storyboard goes through `storyboardSchema.parse`, as the render
 * worker does, then `renderStill` of the storyboard composition for its size.
 * Case media is referenced by relative URL (`media/a.png`); it reaches Remotion
 * as data URIs, so no file server is involved.
 *
 * Run it inside the production image, so Chrome, fonts and the emoji font match
 * exports (crates/renderer/AGENTS.md has the command):
 *
 *   bun packages/video/scripts/render-golden.ts [case ...]
 *
 * It rewrites `manifest.json` with the Remotion version, the emoji font package
 * version and the image named by MALEO_GOLDEN_IMAGE. A reference change is a
 * reviewed commit; CI never runs this. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { aspectMap, storyboardSchema } from "../src/schema.ts";
import { VIDEO_ENTRY } from "../src/paths.ts";

const corpus = new URL("../../../crates/renderer/corpus/", import.meta.url).pathname;
const manifestPath = join(corpus, "manifest.json");
/** `corpus/manifest.json`, as crates/renderer/tests/golden reads it. */
interface Manifest {
	remotion: string;
	image: string;
	emojiFont: { package: string; version: string; file: string; sha256: string };
	thresholds: { frame: number; region: number };
	lowered: Record<string, { frame?: number; region?: number; reason: string }>;
	supportedOptions: Record<string, { case: string; frames: number[] }>;
}
// SAFETY: manifest.json is this corpus's own file, written in this shape by
// this script and read by crates/renderer/tests/golden.
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

interface Case {
	width: number;
	height: number;
	frames: number[];
	options?: string[];
}

const COMPOSITIONS: Record<string, string> = {
	[`${aspectMap.vertical.width}x${aspectMap.vertical.height}`]: "StoryboardReel",
	[`${aspectMap.square.width}x${aspectMap.square.height}`]: "StoryboardSquare",
	[`${aspectMap.horizontal.width}x${aspectMap.horizontal.height}`]: "StoryboardWide",
};
const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
};

/** Replaces every `media/<file>` string in the storyboard with a data URI. */
function inlineMedia(value: unknown, dir: string): unknown {
	if (typeof value === "string" && value.startsWith("media/")) {
		const mime = MIME[extname(value).toLowerCase()];
		if (!mime) throw new Error(`${dir}: unsupported media ${value}`);
		return `data:${mime};base64,${readFileSync(join(dir, value)).toString("base64")}`;
	}
	if (Array.isArray(value)) return value.map((item) => inlineMedia(item, dir));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inlineMedia(v, dir)]));
	return value;
}

function emojiFontVersion(): string {
	try {
		return execFileSync("dpkg-query", ["-W", "-f=${Version}", "fonts-noto-color-emoji"], {
			encoding: "utf8",
		});
	} catch {
		throw new Error("fonts-noto-color-emoji is not installed: run this in the production image");
	}
}

const only = new Set(process.argv.slice(2));
const cases = readdirSync(corpus, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && (only.size === 0 || only.has(entry.name)))
	.map((entry) => entry.name)
	.sort();
const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY });
// Emulated or small hosts are slow; a stuck frame should fail, not hang.
const timeoutInMilliseconds = 180_000;
const browser = await openBrowser("chrome");
try {
	for (const name of cases) {
		const dir = join(corpus, name);
		// SAFETY: case.json is this corpus's own file, shaped as `Case`.
		const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as Case;
		const id = COMPOSITIONS[`${spec.width}x${spec.height}`];
		if (!id) throw new Error(`${name}: no storyboard composition is ${spec.width}x${spec.height}`);
		const storyboard = JSON.parse(readFileSync(join(dir, "storyboard.json"), "utf8"));
		const inputProps = storyboardSchema.parse(inlineMedia(storyboard, dir));
		console.log(`${name}: ${id}`);
		const composition = await selectComposition({
			serveUrl,
			id,
			inputProps,
			timeoutInMilliseconds,
			puppeteerInstance: browser,
		});
		mkdirSync(join(dir, "reference"), { recursive: true });
		for (const frame of spec.frames) {
			const output = join(dir, "reference", `${frame}.png`);
			await renderStill({
				puppeteerInstance: browser,
				composition,
				serveUrl,
				output,
				frame,
				inputProps,
				imageFormat: "png",
				timeoutInMilliseconds,
			});
			console.log(output);
		}
	}
} finally {
	await browser.close({ silent: true });
}

const remotion = JSON.parse(
	readFileSync(new URL("../node_modules/@remotion/renderer/package.json", import.meta.url), "utf8"),
).version;
writeFileSync(
	manifestPath,
	`${JSON.stringify(
		{
			...manifest,
			remotion,
			image: process.env.MALEO_GOLDEN_IMAGE ?? manifest.image,
			emojiFont: { ...manifest.emojiFont, version: emojiFontVersion() },
		},
		null,
		"\t",
	)}\n`,
);
