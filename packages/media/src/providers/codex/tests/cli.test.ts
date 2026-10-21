import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexImageArgs, buildCodexImagePrompt, parseCodexOutputPath } from "../index.ts";
import { restoreEnv, snapshotEnv } from "./env.ts";

const snapshot = snapshotEnv();
const created: string[] = [];

afterEach(() => {
	restoreEnv(snapshot);
	for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("codex CLI invocation", () => {
	it("enables image generation and confines writes to the run workspace", () => {
		const args = buildCodexImageArgs({ workDir: "/tmp/run", references: [] });
		expect(args.slice(0, 2)).toEqual(["exec", "--color"]);
		expect(args).toContain("--enable");
		expect(args[args.indexOf("--enable") + 1]).toBe("image_generation");
		expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");
		expect(args[args.indexOf("-C") + 1]).toBe("/tmp/run");
		expect(args[args.indexOf("--output-last-message") + 1]).toBe(
			join("/tmp/run", "codex-image-result.txt"),
		);
		// Prompt arrives on stdin, never as an argv element.
		expect(args.at(-1)).toBe("-");
	});

	it("keeps the invocation single-shot and free of user config hooks", () => {
		const args = buildCodexImageArgs({ workDir: "/tmp/run", references: [] });
		expect(args).toContain("--ephemeral");
		expect(args).toContain("--ignore-user-config");
		expect(args).toContain("--skip-git-repo-check");
		expect(args).toContain("tools.web_search=false");
	});

	it("attaches references as CLI image inputs and honors a model override", () => {
		const args = buildCodexImageArgs({
			workDir: "/tmp/run",
			references: ["/a.png", "/b.png"],
			model: "gpt-5.5",
		});
		expect(args.filter((a, i) => args[i - 1] === "-i")).toEqual(["/a.png", "/b.png"]);
		expect(args).toContain("model=gpt-5.5");
	});

	it("omits the model override when none is configured", () => {
		expect(buildCodexImageArgs({ workDir: "/tmp/run", references: [] }).join(" ")).not.toContain(
			"model=",
		);
	});
});

describe("codex CLI prompt", () => {
	it("invokes the imagegen skill with the caller prompt and asks only for the path", () => {
		const prompt = buildCodexImagePrompt({
			prompt: "a red fox, no text",
			aspect: "9:16",
			references: [],
		});
		expect(prompt.startsWith("$imagegen a red fox, no text")).toBe(true);
		expect(prompt).toContain("Aspect ratio: 9:16");
		expect(prompt).toContain("ONLY the absolute path");
		expect(prompt).not.toContain("Aspect ratio: undefined");
	});

	it("mentions attachments only when references are staged", () => {
		expect(buildCodexImagePrompt({ prompt: "p", references: [] })).not.toContain("attached image");
		expect(buildCodexImagePrompt({ prompt: "p", references: ["/a.png"] })).toContain(
			"1 attached image",
		);
	});
});

describe("codex CLI output path parsing", () => {
	it("takes the last non-empty line and strips quoting", () => {
		expect(parseCodexOutputPath("Done.\n\n`/tmp/run/out.png`\n", "/tmp/run")).toBe(
			"/tmp/run/out.png",
		);
		expect(parseCodexOutputPath("out.png", "/tmp/run")).toBe("/tmp/run/out.png");
	});

	it("accepts a path inside Codex image storage", () => {
		process.env.CODEX_HOME = "/tmp/codex-home";
		expect(parseCodexOutputPath("/tmp/codex-home/generated_images/x.png", "/tmp/run")).toBe(
			"/tmp/codex-home/generated_images/x.png",
		);
	});

	it("rejects a model-reported path outside the workspace and Codex storage", () => {
		process.env.CODEX_HOME = "/tmp/codex-home";
		expect(() => parseCodexOutputPath("/etc/passwd", "/tmp/run")).toThrow(/outside its workspace/);
		expect(() => parseCodexOutputPath("../../etc/hosts", "/tmp/run")).toThrow(
			/outside its workspace/,
		);
	});

	it("rejects an empty last message", () => {
		expect(() => parseCodexOutputPath("   \n\n", "/tmp/run")).toThrow(/no output image path/);
	});

	/* macOS `/var` is a symlink to `/private/var`, so a workspace created under
	 * `mkdtemp` comes back from Codex with a `/private` prefix. A raw string
	 * compare rejected the provider's own output file. */
	it("accepts the workspace reported through its resolved symlink", () => {
		const real = mkdtempSync(join(tmpdir(), "codex-real-"));
		const link = `${real}-link`;
		symlinkSync(real, link);
		created.push(real, link);
		const reported = join(real, "out.png");
		writeFileSync(reported, "png");

		expect(parseCodexOutputPath(reported, link)).toBe(reported);
	});

	it("rejects a symlink inside the workspace that escapes it", () => {
		const workDir = mkdtempSync(join(tmpdir(), "codex-run-"));
		const outside = mkdtempSync(join(tmpdir(), "codex-outside-"));
		const secret = join(outside, "secret.png");
		writeFileSync(secret, "not yours");
		const escape = join(workDir, "out.png");
		symlinkSync(secret, escape);
		created.push(workDir, outside);

		expect(() => parseCodexOutputPath(escape, workDir)).toThrow(/outside its workspace/);
	});
});
