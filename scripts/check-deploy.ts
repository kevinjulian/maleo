#!/usr/bin/env bun
/**
 * Deployment gate.
 *
 * Failures this repository has no other way to see, all of which surface
 * far from their cause:
 *
 * 1. **Build context growth.** Every image builds from the repository root, so
 *    the daemon reads whatever `.dockerignore` does not exclude. `data/` alone
 *    is 27 GB. A new unignored runtime directory turns a working build into one
 *    that hangs, with nothing in the diff pointing at it.
 * 2. **A missing system binary.** `local-whisper.ts` and `audio-duration.ts`
 *    shell `ffmpeg` and `ffprobe`. `oven/bun` has neither, so the absence shows
 *    up as a failed caption request in production rather than a failed build.
 * 3. **A colliding Inngest app id.** Two function hosts registering the same id
 *    means the second sync replaces the first: the displaced functions have no
 *    handler, their events trigger nothing, and neither process logs an error.
 *
 * 4. **Drift between the deployment targets.** The self-host and Coolify
 *    compose files are full copies; a fix made in one silently misses the other.
 *
 * Pure functions here, IO in `main`. Runs in `bun run ci`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type CheckResult = { ok: true; detail: string } | { ok: false; message: string };

/**
 * Budget for the root build context. Sized for the source tree plus lockfiles
 * with room to grow; the point is to fail loudly when a gigabyte-scale runtime
 * directory stops being excluded, not to police a few megabytes.
 */
export const CONTEXT_BUDGET_BYTES = 50 * 1024 * 1024;

/** Binaries the API process shells at runtime, and the image must therefore install. */
export const API_REQUIRED_BINARIES = ["ffmpeg", "ffprobe"] as const;

// ---------------------------------------------------------------------------
// 1. Build context size
// ---------------------------------------------------------------------------

/** Ignore patterns, comments and blank lines dropped, in file order. */
export function parseDockerignore(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Whether a context-relative posix path is excluded.
 *
 * Docker's matcher is its own; this approximates it with glob semantics, which
 * agrees on every pattern shape this repository uses. A later `!pattern`
 * re-includes a path an earlier pattern excluded, as Docker does.
 */
export function isIgnored(path: string, patterns: string[]): boolean {
	let ignored = false;
	for (const pattern of patterns) {
		const negated = pattern.startsWith("!");
		const body = negated ? pattern.slice(1) : pattern;
		if (matches(path, body)) ignored = !negated;
	}
	return ignored;
}

function matches(path: string, pattern: string): boolean {
	const trimmed = pattern.replace(/\/+$/, "");
	// A directory pattern excludes the directory and everything beneath it.
	return new Bun.Glob(trimmed).match(path) || new Bun.Glob(`${trimmed}/**`).match(path);
}

export type ContextMeasurement = {
	bytes: number;
	files: number;
	/** Largest included entries, biggest first, for a useful failure message. */
	largest: { path: string; bytes: number }[];
};

/**
 * Walk what the daemon would read. Symlinks are counted but never followed —
 * Docker sends them as links, and following them here would descend the
 * self-referential chain under the since-removed `packages/vui/examples/generic/node_modules`
 * until the path is too long to open.
 */
export function measureContext(root: string, patterns: string[]): ContextMeasurement {
	const sizes = new Map<string, number>();
	let bytes = 0;
	let files = 0;

	const walk = (dir: string, topLevel: string | undefined): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const absolute = join(dir, entry.name);
			const rel = relative(root, absolute).split(sep).join("/");
			if (isIgnored(rel, patterns)) continue;
			const top = topLevel ?? rel;
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				walk(absolute, top);
				continue;
			}
			if (!entry.isFile()) continue;
			const size = statSync(absolute).size;
			bytes += size;
			files += 1;
			sizes.set(top, (sizes.get(top) ?? 0) + size);
		}
	};
	walk(root, undefined);

	const largest = [...sizes]
		.map(([path, size]) => ({ path, bytes: size }))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, 5);
	return { bytes, files, largest };
}

export function checkContextSize(
	measurement: ContextMeasurement,
	budget = CONTEXT_BUDGET_BYTES,
): CheckResult {
	const size = formatBytes(measurement.bytes);
	if (measurement.bytes <= budget) {
		return { ok: true, detail: `build context ${size} across ${measurement.files} files` };
	}
	return {
		ok: false,
		message: [
			`build context is ${size}, over the ${formatBytes(budget)} budget`,
			...measurement.largest.map(
				(entry) => `  ${formatBytes(entry.bytes).padStart(9)}  ${entry.path}`,
			),
			"  -> exclude the runtime directory in .dockerignore, or raise CONTEXT_BUDGET_BYTES deliberately",
		].join("\n"),
	};
}

function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------
// 2. System binaries present in the image
// ---------------------------------------------------------------------------

/** Binary names the given sources invoke through a spawn, `which`, or exec call. */
export function findShelledBinaries(sources: string[], candidates: readonly string[]): string[] {
	const found = new Set<string>();
	for (const source of sources) {
		for (const binary of candidates) {
			if (new RegExp(`["'\`]${binary}["'\`]`).test(source)) found.add(binary);
		}
	}
	return [...found].sort();
}

/** A Dockerfile satisfies a binary when some instruction names it. */
export function checkImageBinaries(dockerfile: string, required: readonly string[]): CheckResult {
	const missing = required.filter((binary) => !new RegExp(`\\b${binary}\\b`).test(dockerfile));
	if (missing.length === 0) {
		return { ok: true, detail: `image installs ${required.join(", ")}` };
	}
	return {
		ok: false,
		message: [
			`the runtime shells ${missing.join(", ")} but the image does not install ${missing.length === 1 ? "it" : "them"}`,
			"  -> add the package to the Dockerfile's install step",
		].join("\n"),
	};
}

// ---------------------------------------------------------------------------
// 3. Inngest app identity
// ---------------------------------------------------------------------------

export type FunctionHost = { service: string; appId: string | undefined };

/**
 * `INNGEST_APP_ID` per compose service, for services that serve durable
 * functions. A service that serves them and sets nothing reads as `undefined`,
 * which is the collision this catches: the client's default is one shared name.
 */
export function parseComposeAppIds(compose: string): FunctionHost[] {
	const hosts: FunctionHost[] = [];
	let service: string | undefined;
	let servesFunctions = false;
	let isServer = false;
	let appId: string | undefined;

	const flush = (): void => {
		if (service && servesFunctions && !isServer) hosts.push({ service, appId });
		service = undefined;
		servesFunctions = false;
		isServer = false;
		appId = undefined;
	};

	for (const line of compose.split("\n")) {
		const serviceMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (serviceMatch) {
			flush();
			service = serviceMatch[1];
			continue;
		}
		// The server itself holds the same keys but registers nothing.
		if (/^\s*image:\s*inngest\//.test(line)) isServer = true;
		if (/INNGEST_SIGNING_KEY|INNGEST_EVENT_KEY/.test(line)) servesFunctions = true;
		const appMatch = /INNGEST_APP_ID:\s*"?([A-Za-z0-9_-]+)"?/.exec(line);
		if (appMatch) appId = appMatch[1];
	}
	flush();
	return hosts;
}

export function checkAppIds(hosts: FunctionHost[]): CheckResult {
	const unset = hosts.filter((host) => !host.appId);
	if (unset.length > 0) {
		return {
			ok: false,
			message: [
				`${unset.map((host) => host.service).join(", ")} serves durable functions without INNGEST_APP_ID`,
				"  -> set it in the compose file; the client default collides with the API's",
			].join("\n"),
		};
	}
	// A replica (`api-2` beside `api`) is the same app on another process, so it
	// registers the same id on purpose; count it as its service.
	const names = new Set(hosts.map((host) => host.service));
	const seen = new Map<string, string[]>();
	for (const host of hosts) {
		const services = seen.get(host.appId!) ?? [];
		const base = replicaBase(host.service, names) ?? host.service;
		if (!services.includes(base)) services.push(base);
		seen.set(host.appId!, services);
	}
	const collisions = [...seen].filter(([, services]) => services.length > 1);
	if (collisions.length > 0) {
		return {
			ok: false,
			message: [
				...collisions.map(
					([appId, services]) => `app id "${appId}" is registered by ${services.join(" and ")}`,
				),
				"  -> the second sync replaces the first and its functions stop running silently",
			].join("\n"),
		};
	}
	return {
		ok: true,
		detail: `${hosts.length} function hosts, distinct app ids: ${[...seen.keys()].join(", ")}`,
	};
}

/** The service a replica copies: `api` for `api-2`, when `api` exists. */
export function replicaBase(service: string, services: ReadonlySet<string>): string | undefined {
	const match = /^(.+)-\d+$/.exec(service);
	return match && services.has(match[1]!) ? match[1] : undefined;
}

/** Each compose service's own lines, keyed by name. */
function serviceBlocks(compose: string): Map<string, string[]> {
	const blocks = new Map<string, string[]>();
	let current: string[] | undefined;
	for (const line of compose.split("\n")) {
		if (/^\S/.test(line)) {
			current = undefined;
			continue;
		}
		const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
		if (header) {
			current = [];
			blocks.set(header[1]!, current);
			continue;
		}
		current?.push(line);
	}
	return blocks;
}

/** Check each target independently: two equally incomplete files still fail. */
export function checkRenderDeployment(compose: string): CheckResult {
	const blocks = serviceBlocks(compose);
	const problems: string[] = [];
	const required = {
		api: [
			"MALEO_VIDEO_URL: http://render-worker:8091",
			"MALEO_VIDEO_TOKEN: ${MALEO_VIDEO_TOKEN:?}",
		],
		"render-worker": [
			"working_dir: /app/apps/render-worker",
			'command: ["bun", "src/index.ts"]',
			"MALEO_VIDEO_PORT: 8091",
			"MALEO_VIDEO_TOKEN: ${MALEO_VIDEO_TOKEN:?}",
			"MALEO_VIDEO_DB: /app/apps/render-worker/data/jobs.db",
			"MALEO_VIDEO_CONCURRENCY: 1",
			"MALEO_VIDEO_PUBLIC_BASE: http://127.0.0.1:8091/public",
			"MALEO_API_URL: http://api:8090",
			"MALEO_SERVICE_TOKEN: ${MALEO_SERVICE_TOKEN:?}",
			"MALEO_MEDIA_STORAGE_BACKEND: s3",
			"MALEO_MEDIA_S3_ENDPOINT: http://rustfs:9000",
			"MALEO_MEDIA_S3_BUCKET: ${MALEO_MEDIA_S3_BUCKET:?}",
			"MALEO_MEDIA_S3_ACCESS_KEY_ID: ${MALEO_MEDIA_S3_ACCESS_KEY_ID:?}",
			"MALEO_MEDIA_S3_SECRET_ACCESS_KEY: ${MALEO_MEDIA_S3_SECRET_ACCESS_KEY:?}",
			"- maleo-render-data:/app/apps/render-worker/data",
			"- maleo-render-out:/app/apps/render-worker/out",
			"- maleo-render-public:/app/apps/render-worker/public",
			"cpus: 2.0",
			"mem_limit: 4g",
			"shm_size: 1g",
		],
	};
	for (const [service, lines] of Object.entries(required)) {
		const block = blocks.get(service);
		if (!block) {
			problems.push(`missing ${service} service`);
			continue;
		}
		const actual = new Set(block.map((line) => line.trim()));
		for (const line of lines) {
			if (!actual.has(line)) problems.push(`${service} requires ${line}`);
		}
	}
	const worker = blocks.get("render-worker") ?? [];
	if (worker.some((line) => /^    (ports:|network_mode:)/.test(line) || /SERVICE_FQDN_/.test(line)))
		problems.push("render-worker must remain on the internal network without public routing");
	if (worker.some((line) => line.startsWith("      api:")))
		problems.push("render-worker must not depend on API readiness");
	if (problems.length) return { ok: false, message: problems.join("\n") };
	return {
		ok: true,
		detail: "authenticated render worker, managed inputs, persistent state, internal access",
	};
}

/* A replica is written out in full, so nothing keeps it equal to its service
 * but this. What may differ: comments, the public-domain variable, and the
 * dependency on the service that orders their first boots. */
function comparable(lines: string[], base: string): string[] {
	const kept: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (!line.trim() || line.trim().startsWith("#") || line.includes("SERVICE_FQDN_")) continue;
		if (line === `      ${base}:` && lines[i + 1]?.trim() === "condition: service_healthy") {
			i += 1;
			continue;
		}
		kept.push(line);
	}
	return kept;
}

export function checkReplicaDrift(compose: string): CheckResult {
	const blocks = serviceBlocks(compose);
	const names = new Set(blocks.keys());
	const pairs: string[] = [];
	for (const [service, lines] of blocks) {
		const base = replicaBase(service, names);
		if (!base) continue;
		const want = comparable(blocks.get(base)!, base);
		const have = comparable(lines, base);
		const missing = want.filter((line) => !have.includes(line));
		const extra = have.filter((line) => !want.includes(line));
		if (missing.length || extra.length) {
			return {
				ok: false,
				message: [
					`${service} has drifted from ${base}:`,
					...missing.map((line) => `  only in ${base}: ${line.trim()}`),
					...extra.map((line) => `  only in ${service}: ${line.trim()}`),
					`  -> make the two blocks match; the replica serves the same traffic`,
				].join("\n"),
			};
		}
		pairs.push(`${service}=${base}`);
	}
	return { ok: true, detail: pairs.length ? `in step: ${pairs.join(", ")}` : "no replicas" };
}

/* The self-host and Coolify files are written out in full, so nothing keeps
 * them equal but this. What may differ: comments, Coolify's routing
 * declarations, and the ports the self-host file publishes. */
function targetComparable(lines: string[]): string[] {
	const kept: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (!line.trim() || line.trim().startsWith("#") || line.includes("SERVICE_FQDN_")) continue;
		if (line === "    ports:") {
			while (lines[i + 1]?.startsWith("      - ")) i += 1;
			continue;
		}
		kept.push(line);
	}
	return kept;
}

export function checkTargetDrift(coolify: string, selfHost: string): CheckResult {
	const a = serviceBlocks(coolify);
	const b = serviceBlocks(selfHost);
	const problems: string[] = [];
	for (const name of new Set([...a.keys(), ...b.keys()])) {
		const want = a.get(name);
		const have = b.get(name);
		if (!want || !have) {
			problems.push(`  ${name} is only in ${want ? "the Coolify file" : "the self-host file"}`);
			continue;
		}
		const w = targetComparable(want);
		const h = targetComparable(have);
		for (const line of w.filter((l) => !h.includes(l)))
			problems.push(`  ${name}: only in Coolify: ${line.trim()}`);
		for (const line of h.filter((l) => !w.includes(l)))
			problems.push(`  ${name}: only in self-host: ${line.trim()}`);
	}
	if (problems.length === 0) return { ok: true, detail: `in step: ${a.size} blocks` };
	return {
		ok: false,
		message: [
			"the self-host and Coolify compose files have drifted:",
			...problems,
			"  -> make the change in both deploy/docker-compose.yml and deploy/docker-compose.coolify.yml",
		].join("\n"),
	};
}

// ---------------------------------------------------------------------------
// 4. Every workspace manifest reaches the image
// ---------------------------------------------------------------------------

/**
 * The images copy workspace manifests one by one so the dependency install sits
 * in its own cached layer. A package added to the workspace and not to that
 * list installs nothing for itself, and the failure is a frozen-lockfile error
 * inside a container rather than anything visible in the diff.
 */
export function checkManifestCoverage(
	workspaceManifests: string[],
	dockerfiles: { path: string; text: string }[],
): CheckResult {
	const gaps: string[] = [];
	for (const { path, text } of dockerfiles) {
		const missing = workspaceManifests.filter((manifest) => !text.includes(`COPY ${manifest} `));
		if (missing.length > 0) gaps.push(`  ${path} omits ${missing.join(", ")}`);
	}
	if (gaps.length === 0) {
		return {
			ok: true,
			detail: `${workspaceManifests.length} workspace manifests copied by every image`,
		};
	}
	return {
		ok: false,
		message: ["a workspace manifest is missing from an image's copy list:", ...gaps].join("\n"),
	};
}

// ---------------------------------------------------------------------------

const COMPOSE_PATH = "deploy/docker-compose.coolify.yml";
const SELF_HOST_COMPOSE_PATH = "deploy/docker-compose.yml";
/** One image serves every deployed process; see the root Dockerfile. */
const IMAGE_DOCKERFILES = ["Dockerfile"];
const BINARY_SOURCES = [
	"apps/api/src/lib/local-whisper.ts",
	"apps/api/src/lib/audio-duration.ts",
	"packages/stock/src/music-audio.ts",
];

/** Every workspace member's package.json, as a context-relative path. */
function workspaceManifests(root: string): string[] {
	const found: string[] = [];
	for (const group of ["packages", "apps"]) {
		for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const manifest = `${group}/${entry.name}/package.json`;
			if (existsSync(join(root, manifest))) found.push(manifest);
		}
	}
	return found.sort();
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const read = (path: string): string => readFileSync(join(root, path), "utf8");

	const patterns = parseDockerignore(read(".dockerignore"));
	const checks: [string, CheckResult][] = [
		["context", checkContextSize(measureContext(root, patterns))],
		[
			"binaries",
			checkImageBinaries(
				read("Dockerfile"),
				findShelledBinaries(BINARY_SOURCES.map(read), API_REQUIRED_BINARIES),
			),
		],
		["app-ids", checkAppIds(parseComposeAppIds(read(COMPOSE_PATH)))],
		["replicas", checkReplicaDrift(read(COMPOSE_PATH))],
		["targets", checkTargetDrift(read(COMPOSE_PATH), read(SELF_HOST_COMPOSE_PATH))],
		["render-coolify", checkRenderDeployment(read(COMPOSE_PATH))],
		["render-self-host", checkRenderDeployment(read(SELF_HOST_COMPOSE_PATH))],
		[
			"manifests",
			checkManifestCoverage(
				workspaceManifests(root),
				IMAGE_DOCKERFILES.map((path) => ({ path, text: read(path) })),
			),
		],
	];

	let failed = false;
	for (const [name, result] of checks) {
		if (result.ok) console.log(`check-deploy: ${name}: ${result.detail}`);
		else {
			console.error(`check-deploy: ${name}: ${result.message}`);
			failed = true;
		}
	}
	if (failed) process.exit(1);
}
