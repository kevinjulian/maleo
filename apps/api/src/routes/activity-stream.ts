import { existsSync, watch } from "node:fs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { activityPath, listWorkspaceNames } from "../lib/workspace-paths.ts";

interface ActivityEvent {
	workspace: string;
	t: number;
	kind: string;
	[k: string]: unknown;
}

async function listWorkspaces(): Promise<string[]> {
	try {
		return await listWorkspaceNames();
	} catch {
		return [];
	}
}

async function tailLatest(file: string, count: number): Promise<string[]> {
	if (!existsSync(file)) return [];
	const f = Bun.file(file);
	const size = f.size;
	const chunk = 64 * 1024;
	const offset = Math.max(0, size - chunk);
	const text = await f.slice(offset, size).text();
	const lines = text.split("\n").filter(Boolean);
	return lines.slice(-count);
}

export function activityStreamRoutes(): Hono {
	const app = new Hono();

	app.get("/", (c) =>
		streamSSE(c, async (stream) => {
			const workspaces = await listWorkspaces();
			// Replay last 10 events from each workspace
			for (const p of workspaces) {
				const file = activityPath(p);
				const last = await tailLatest(file, 10);
				for (const line of last) {
					try {
						const ev = JSON.parse(line) as ActivityEvent;
						ev.workspace = p;
						await stream.writeSSE({
							data: JSON.stringify(ev),
							event: "activity",
						});
					} catch {}
				}
			}

			// Watch each workspace file for new lines
			const sizes = new Map<string, number>();
			const watchers: ReturnType<typeof watch>[] = [];
			let alive = true;

			c.req.raw.signal.addEventListener("abort", () => {
				alive = false;
				for (const w of watchers) w.close();
			});

			for (const p of workspaces) {
				const file = activityPath(p);
				if (!existsSync(file)) continue;
				sizes.set(p, Bun.file(file).size);
				const tail = async (): Promise<void> => {
					if (!alive) return;
					const f = Bun.file(file);
					const newSize = f.size;
					const prev = sizes.get(p) ?? newSize;
					if (newSize <= prev) {
						sizes.set(p, newSize);
						return;
					}
					const text = await f.slice(prev, newSize).text();
					sizes.set(p, newSize);
					for (const line of text.split("\n").filter(Boolean)) {
						try {
							const ev = JSON.parse(line) as ActivityEvent;
							ev.workspace = p;
							await stream.writeSSE({
								data: JSON.stringify(ev),
								event: "activity",
							});
						} catch {}
					}
				};
				const w = watch(file, () => {
					tail().catch((err: unknown) => console.error(`[activity-stream] ${p}: tail failed`, err));
				});
				watchers.push(w);
			}

			// Heartbeat every 25s so proxies don't close idle connection
			while (alive) {
				await new Promise((r) => setTimeout(r, 25_000));
				if (!alive) break;
				await stream.writeSSE({ data: "ping", event: "heartbeat" });
			}
		}),
	);

	return app;
}
