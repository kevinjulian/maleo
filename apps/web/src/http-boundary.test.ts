/* One HTTP boundary, enforced by reading the source.
 *
 * Fifteen call sites used to call `fetch()` with a path the app never resolved
 * through `apiUrl()`. Under cross-origin mode (`MALEO_API_URL` set, no proxy)
 * those calls resolved against the WEB origin while every call that went through
 * the helpers reached the api — so the chat agent, run history, TTS, upload and
 * animate paths broke in exactly the deployment the helpers were built for. They
 * also skipped the 401 redirect.
 *
 * A type cannot catch this: both spellings are a legal call returning a promise.
 * Reading the source can, so this test does. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname);

/** `api/client.ts` IS the boundary — it is the one file allowed to call
 *  fetch with a path, because it is the thing that resolves them. */
const ALLOWED = new Set(["api/client.ts"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, found);
			continue;
		}
		if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
	}
	return found;
}

describe("every browser request goes through the HTTP boundary", () => {
	test("no source file calls fetch with an unresolved /api path", () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			if (ALLOWED.has(file.slice(SRC.length + 1))) continue;
			const source = readFileSync(file, "utf8");

			// `fetch("/api/...")` or fetch(`${BASE}/...`) — a path handed to fetch
			// without passing through apiUrl(). An absolute URL is fine (it names its
			// own origin), and so is `fetch(apiUrl(...))`.
			for (const match of source.matchAll(/\bfetch\(\s*[`"'](\/[^`"']*|\$\{BASE\}[^`"']*)/g)) {
				offenders.push(`${file.slice(SRC.length + 1)} → fetch("${match[1]?.slice(0, 40)}…")`);
			}
		}

		expect(offenders).toEqual([]);
	});
});
