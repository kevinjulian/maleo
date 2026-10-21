#!/usr/bin/env bun
/**
 * Local setup diagnostic.
 *
 * Prepares the local app. Provider credentials remain optional.
 *
 * The root `.env` is the single env file for repo processes. This script never
 * creates package-local `.env` files — see AGENTS.md, "Environment".
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OK = "\x1b[32m[ok]\x1b[0m";
const WARN = "\x1b[33m[!!]\x1b[0m";
const INFO = "\x1b[36m[--]\x1b[0m";

console.log("\x1b[1m\nmaleo setup\x1b[0m\n");

console.log(`${OK} bun ${Bun.version}`);

// 1. Dependencies
if (existsSync(join(ROOT, "node_modules"))) {
	console.log(`${OK} node_modules present`);
} else {
	console.log(`${INFO} installing dependencies...`);
	const install = Bun.spawnSync(["bun", "install"], {
		cwd: ROOT,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (install.exitCode !== 0) {
		console.error(
			`bun install failed (exit ${install.exitCode}). Run bun install and retry setup.`,
		);
		process.exit(1);
	}
	console.log(`${OK} dependencies installed`);
}

const inngest = join(ROOT, "node_modules", ".bin", "inngest");
if (!existsSync(inngest)) {
	console.error("Inngest CLI missing. Run bun install --frozen-lockfile and retry setup.");
	process.exit(1);
}
const inngestVersion = Bun.spawnSync([inngest, "version"], {
	cwd: ROOT,
	stdout: "pipe",
	stderr: "pipe",
});
if (inngestVersion.exitCode !== 0) {
	console.error("Inngest CLI cannot start. Run bun install --frozen-lockfile and retry setup.");
	process.exit(1);
}
console.log(`${OK} Inngest CLI ${new TextDecoder().decode(inngestVersion.stdout).trim()}`);
const vp = join(ROOT, "node_modules", ".bin", "vp");
if (!existsSync(vp)) {
	console.error("Vite+ CLI missing. Run bun install --frozen-lockfile and retry setup.");
	process.exit(1);
}

// 2. Root .env — the single env file for every repo process.
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
	console.log(`${OK} root .env exists`);
} else {
	writeFileSync(
		envPath,
		[
			"# Root .env — the single env file for repo processes.",
			"# Do not add package-local .env files under packages/* or apps/*.",
			"# Local media storage is explicit. Production requires S3-compatible storage.",
			"",
			"# Service ports (defaults are used when unset)",
			"# MALEO_API_PORT=",
			"# MALEO_WEB_PORT=3030",
			"# MALEO_MEDIA_WORKER_PORT=",
			"# MALEO_VIDEO_PORT=",
			"",
			"# Runtime data (defaults to <repo>/data)",
			"# MALEO_DATA_DIR=",
			"# Postgres: unset in development (an embedded server starts under <data>/postgres)",
			"# MALEO_DATABASE_URL=",
			"MALEO_MEDIA_STORAGE_BACKEND=local",
			"",
			"# Durable generation: set to enable the media worker in `bun run dev`",
			"# MALEO_GEN_WORKER_URL=",
			"",
			"# Provider credentials — add only the ones you use",
			"# OPENAI_API_KEY=",
			"# ELEVENLABS_API_KEY=",
			"",
		].join("\n"),
	);
	console.log(`${WARN} root .env created with defaults — add credentials as you need them`);
	console.log(`   Full variable reference: \x1b[36m.env.example\x1b[0m`);
}

// 3. Runtime data directories
const dataDir = process.env.MALEO_DATA_DIR ?? join(ROOT, "data");
if (existsSync(dataDir)) {
	console.log(`${OK} data dir: ${dataDir}`);
} else {
	mkdirSync(dataDir, { recursive: true });
	console.log(`${WARN} data dir created: ${dataDir}`);
}

if (process.env.MALEO_DATABASE_URL) {
	console.log(`${OK} runtime db: MALEO_DATABASE_URL`);
} else {
	const cluster = join(dataDir, "postgres");
	console.log(
		existsSync(cluster)
			? `${OK} runtime db: embedded Postgres at ${cluster}`
			: `${INFO} runtime db not created yet: embedded Postgres at ${cluster}`,
	);
}
const legacyDb = process.env.MALEO_DB_PATH ?? join(dataDir, "maleo.db");
if (existsSync(legacyDb)) {
	console.log(
		`${WARN} pre-Postgres SQLite database at ${legacyDb} — carry it over once with \x1b[36mbun run db:migrate-from-sqlite\x1b[0m`,
	);
}

const skillsDir = join(dataDir, "skills");
if (existsSync(skillsDir)) {
	const skills = readdirSync(skillsDir).filter((n) => n.endsWith(".yaml")).length;
	console.log(`${OK} skill library: ${skills} skill${skills === 1 ? "" : "s"}`);
} else {
	console.log(`${INFO} no skill library at ${skillsDir}`);
}

// 4. Provider credentials — reported, never required.
const PROVIDER_VARS = [
	["OPENAI_API_KEY", "OpenAI text and image"],
	["ELEVENLABS_API_KEY", "ElevenLabs speech"],
	["MALEO_GEN_WORKER_URL", "durable generation via the media worker"],
] as const;

const envText = existsSync(envPath) ? await Bun.file(envPath).text() : "";
const isSet = (name: string): boolean =>
	new RegExp(`^\\s*${name}\\s*=\\s*\\S`, "m").test(envText) || Boolean(process.env[name]);

console.log("");
for (const [name, purpose] of PROVIDER_VARS) {
	console.log(
		isSet(name) ? `${OK} ${name} set` : `${INFO} ${name} not set — ${purpose} unavailable`,
	);
}

// 5. Voice sample readiness. Reported, not run: baking is a multi-minute job
// against live providers, while setup is a millisecond local diagnostic — and an
// unbaked environment is fully functional, just without audition clips.
const uploadsDir = join(ROOT, "apps", "api", "public", "uploads");
const bakedSamples = existsSync(uploadsDir)
	? readdirSync(uploadsDir).filter((name) => name.startsWith("voice-sample-")).length
	: 0;
console.log("");
if (bakedSamples > 0) {
	console.log(`${OK} ${bakedSamples} voice sample${bakedSamples === 1 ? "" : "s"} baked`);
} else {
	console.log(`${INFO} no voice samples baked (pickers work, just without audition clips)`);
	console.log(`   Bake them with: \x1b[36mbun run bake:voice-samples\x1b[0m`);
}

try {
	const { databaseReady, closeMaleoDb } = await import("../packages/db/src/db/connection.ts");
	await databaseReady();
	const { ensureAuthTables } = await import("../packages/auth/src/config.ts");
	await ensureAuthTables();
	await closeMaleoDb();
	console.log(`${OK} database migrated and ready`);
} catch (error) {
	console.error(`Database setup failed: ${error instanceof Error ? error.message : String(error)}`);
	console.error(
		"Check MALEO_DATABASE_URL or local Postgres prerequisites, then retry bun run setup.",
	);
	process.exit(1);
}

console.log(
	"\n\x1b[1mReady.\x1b[0m Run: \x1b[36mbun run dev\x1b[0m  then open http://localhost:3030\n",
);
process.exit(0); // embedded Postgres keeps a child handle; its watchdog stops it on exit
