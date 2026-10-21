import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test } from "vite-plus/test";
import { setKeys } from "../packages/shared/src/editor/commands.ts";
import { applyCommand } from "../packages/shared/src/editor/engine-registry.ts";
import { sampleScope } from "../packages/shared/src/editor/sample-scope.ts";

const root = join(import.meta.dirname, "..");
const underTemp = (path: string | undefined): boolean =>
	path !== undefined && !relative(tmpdir(), path).startsWith("..");

const WORKSPACES = [
	"apps/api",
	"apps/render-worker",
	"apps/web",
	"packages/auth",
	"packages/db",
	"packages/inngest",
	"packages/media",
	"packages/shared",
	"packages/stock",
	"packages/storage",
	"packages/video",
];

test("every runner a test command starts loads the data guard", () => {
	const config = readFileSync(join(root, "vite.config.ts"), "utf8");
	expect(config).toMatch(
		/setupFiles: \[join\(import\.meta\.dirname, "scripts\/test-db-guard\.ts"\)\]/,
	);
	const bunConfig = (path: string): string => {
		try {
			return readFileSync(join(root, path, "bunfig.toml"), "utf8");
		} catch {
			return "";
		}
	};
	for (const path of WORKSPACES) {
		const manifest = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		for (const command of Object.values(manifest.scripts)) {
			for (const bun of command.match(/bun test[^&|;]*/g) ?? []) {
				const preloaded =
					bun.includes("--preload ../../scripts/test-db-guard.ts") ||
					bunConfig(path).includes("../../scripts/test-db-guard.ts");
				expect(preloaded, `${path}: ${bun}`).toBe(true);
			}
		}
	}
	const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		scripts: Record<string, string>;
	};
	expect(rootManifest.scripts["test:bun"]).toContain("--preload ./test-db-guard.ts");
});

/* Vitest runs the guard as a setup file in this worker, before this file's imports. */
test("a Vitest worker holds only temporary state and no credentials or live endpoints", () => {
	for (const key of [
		"MALEO_DB_PATH",
		"GEN_WORKER_DB",
		"MALEO_VIDEO_DB",
		"MALEO_DATA_DIR",
		"CACHE_DIR",
	]) {
		expect(underTemp(process.env[key]), key).toBe(true);
	}
	expect(process.env.MALEO_DATABASE_URL).toBe("");
	expect(process.env.MALEO_PG_EPHEMERAL).toBe("1");
	expect(process.env.MALEO_MEDIA_STORAGE_BACKEND).toBe("local");
	for (const key of [
		"MALEO_API_URL",
		"MALEO_API_URLS",
		"MALEO_VIDEO_URL",
		"MALEO_GEN_WORKER_URL",
		"MALEO_IMAGE_URL",
		"OPENAI_API_KEY",
		"ELEVENLABS_API_KEY",
		"MALEO_AI_API_KEY",
		"HF_TOKEN",
		"MALEO_CF_API_TOKEN",
		"PEXELS_API_KEY",
		"FREESOUND_API_KEY",
	]) {
		expect(process.env[key], key).toBeUndefined();
	}
});

// Cold WASM initialization took 5.8s under full-suite coverage; edit latency has separate budget tests.
test("a Vitest worker executes editor commands through the real engine", () => {
	const scope = sampleScope();
	const keyed = applyCommand(scope, setKeys("video:1", "scale", [{ t: 0, v: 1 }]));
	expect(keyed).not.toBe(scope);
	expect(applyCommand(keyed, setKeys("video:1", "scale", [{ t: 0, v: 1 }]))).toBe(keyed);
}, 15_000);

test("the Bun preload replaces a configured local instance with temporary state", async () => {
	const unsafe = join(root, "data", "test-guard-must-not-open.sqlite");
	const env: Record<string, string | undefined> = {
		...process.env,
		GEN_WORKER_DB: unsafe,
		MALEO_VIDEO_DB: unsafe,
		MALEO_DATA_DIR: join(root, "data"),
		MALEO_API_URL: "https://configured.example/api",
		MALEO_VIDEO_URL: "https://configured.example/video",
	};
	delete env.MALEO_DB_PATH;
	delete env.MALEO_TEST_GUARD_PID;
	const child = spawn(
		"bun",
		[
			"--preload",
			join(root, "scripts/test-db-guard.ts"),
			"-e",
			"console.log(JSON.stringify({worker:process.env.GEN_WORKER_DB,video:process.env.MALEO_VIDEO_DB,data:process.env.MALEO_DATA_DIR,cache:process.env.CACHE_DIR,api:process.env.MALEO_API_URL,videoUrl:process.env.MALEO_VIDEO_URL,storage:process.env.MALEO_MEDIA_STORAGE_BACKEND,ephemeral:process.env.MALEO_PG_EPHEMERAL}))",
		],
		{ cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
	const exit = await new Promise<number | null>((done) => child.on("close", done));
	expect(exit, stderr).toBe(0);
	expect(stderr).not.toContain("error:");
	const state = JSON.parse(stdout.trim()) as Record<string, string>;
	for (const key of ["worker", "video", "data", "cache"]) {
		expect(underTemp(state[key]), key).toBe(true);
	}
	expect(state.worker).not.toBe(unsafe);
	expect(state.video).not.toBe(unsafe);
	expect(state.api).toBeUndefined();
	expect(state.videoUrl).toBeUndefined();
	expect(state.storage).toBe("local");
	expect(state.ephemeral).toBe("1");
});
