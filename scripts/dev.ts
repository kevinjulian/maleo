#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const inngest = join(root, "node_modules", ".bin", "inngest");
const apiPort = Number(process.env.MALEO_API_PORT || 8090);
const webPort = Number(process.env.MALEO_WEB_PORT || 3030);
const workerPort = Number(process.env.MALEO_MEDIA_WORKER_PORT || 7071);
const workerEnabled = Boolean(process.env.MALEO_GEN_WORKER_URL?.trim());
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

interface Service {
	name: string;
	cwd: string;
	command: string[];
	ready: string;
}

const services: Service[] = [
	{ name: "api", cwd: "apps/api", command: ["bun", "run", "dev"], ready: `${apiUrl}/health` },
	{ name: "web", cwd: "apps/web", command: ["bun", "run", "dev"], ready: webUrl },
];
if (workerEnabled) {
	services.push({
		name: "media-worker",
		cwd: "apps/media-worker",
		command: ["bun", "run", "dev"],
		ready: `http://127.0.0.1:${workerPort}/health`,
	});
}
services.push({
	name: "inngest",
	cwd: ".",
	ready: "http://127.0.0.1:8288/health",
	command: [
		inngest,
		"dev",
		"--no-discovery",
		"-u",
		`${apiUrl}/api/inngest`,
		...(workerEnabled ? ["-u", `http://127.0.0.1:${workerPort}/api/inngest`] : []),
	],
});

const only = process.argv
	.find((arg) => arg.startsWith("--only="))
	?.slice(7)
	.split(",");
const selected = only ? services.filter((service) => only.includes(service.name)) : services;
if (
	!selected.length ||
	(only && only.some((name) => !selected.some((service) => service.name === name)))
) {
	console.error("Unknown --only service. Choose api, web, media-worker, or inngest.");
	process.exit(1);
}
if (selected.some((service) => service.name === "inngest") && !existsSync(inngest)) {
	console.error("Inngest CLI missing. Run bun install --frozen-lockfile, then bun run setup.");
	process.exit(1);
}
if (selected.some((service) => service.name === "web" || service.name === "api")) {
	/* The editor and the API's agent edits both execute through the Rust engine
	 * (the web fetches it as /editor-engine.wasm), so either needs the release build. */
	const build = Bun.spawnSync(["bun", "scripts/editor-engine.mts", "build"], {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (build.exitCode !== 0) {
		console.error(
			"Editor engine build failed. Install rustup (brew install rustup), then retry bun run dev.",
		);
		process.exit(1);
	}
}

const children: Array<{ service: Service; process: ReturnType<typeof Bun.spawn> }> = [];
let stopping = false;
function stop(code: number): void {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.process.kill();
	process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function pipe(name: string, stream: ReadableStream<Uint8Array> | null): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		pending += decoder.decode(value, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) console.log(`[${name}] ${line}`);
	}
	if (pending) console.log(`[${name}] ${pending}`);
}

async function waitReady(service: Service, child: ReturnType<typeof Bun.spawn>): Promise<void> {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`${service.name} exited ${child.exitCode} before ready`);
		try {
			const response = await fetch(service.ready, { signal: AbortSignal.timeout(1500) });
			if (response.ok) {
				if (service.name === "web") {
					const html = await response.text();
					const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"/i)?.[1];
					if (!script) throw new Error("web entry script missing");
					const bundle = await fetch(new URL(script, service.ready), {
						signal: AbortSignal.timeout(5000),
					});
					if (!bundle.ok) throw new Error(`web bundle returned ${bundle.status}`);
				}
				return;
			}
		} catch {
			/* service starting */
		}
		await Bun.sleep(300);
	}
	throw new Error(`${service.name} did not answer ${service.ready} within 60s`);
}

try {
	for (const service of selected) {
		const child = Bun.spawn(service.command, {
			cwd: join(root, service.cwd),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				INNGEST_DEV: "1",
				INNGEST_BASE_URL: "http://127.0.0.1:8288",
				...(service.name === "web" && !process.env.MALEO_API_URL && !process.env.MALEO_API_URLS
					? { MALEO_API_URL: apiUrl }
					: {}),
			},
		});
		children.push({ service, process: child });
		void pipe(service.name, child.stdout);
		void pipe(service.name, child.stderr);
		await waitReady(service, child);
		console.log(`[dev] ${service.name} ready: ${service.ready}`);
	}
	console.log(`[dev] App ready: ${webUrl}`);
	await Promise.race(
		children.map(async ({ service, process }) => {
			const code = await process.exited;
			throw new Error(`${service.name} exited ${code}`);
		}),
	);
} catch (error) {
	console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
	console.error(
		"Run bun run setup, check occupied ports and service logs, then retry bun run dev.",
	);
	stop(1);
}
