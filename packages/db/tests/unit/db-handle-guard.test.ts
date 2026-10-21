/* Every database function takes the handle its caller passes.
 *
 * This guard exists because `project-detail.ts` was missed by the pass that added
 * the parameter: `getContentProject` kept opening the shared connection, so
 * `createContentProject` wrote to a test's database and then read the project back
 * from the real one. The tests still passed — they only checked the write — and
 * the reads silently came from somewhere else.
 *
 * Three properties, all checked against the source: a data function declares the
 * handle, a function that declares one actually uses it, and a function that
 * declares one forwards it to every family function it calls.
 *
 * The third property was added after the same bug survived the first two.
 * `getContentProject` declared the handle and used it for its own queries, then
 * called `listProjectReferences(id)` and `listProjectSpeakers(id)` without it — so
 * one function read the project from the caller's database and the roster from the
 * global one. Declaring a handle is not the contract; passing it on is. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(import.meta.dirname, "../../src/db");

/* Modules that legitimately do not take a handle: the connection owns it, the
 * schema is applied to a handle it is given, decoders and types touch no
 * database, and the barrel only re-exports. */
const NOT_FAMILIES = new Set([
	"connection.ts",
	"database-config.ts",
	"legacy-sqlite.ts",
	"database-config.ts",
	"legacy-sqlite.ts",
	"handle.ts",
	"handle-testing.ts",
	"pg.ts",
	"pg-embedded.ts",
	"pg-testing.ts",
	"migrate.ts",
	"schema.ts",
	"unified-schema.ts",
	"row-json.ts",
	"content-types.ts",
	"maleo-db.ts",
	"workflow-run-db.ts",
]);

function familyFiles(): string[] {
	return readdirSync(DB_DIR).filter(
		(f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !NOT_FAMILIES.has(f),
	);
}

interface Fn {
	file: string;
	name: string;
	params: string;
	body: string;
}

function exportedFunctions(): Fn[] {
	const out: Fn[] = [];
	for (const file of familyFiles()) {
		const src = readFileSync(join(DB_DIR, file), "utf8");
		for (const m of src.matchAll(
			/export (?:async )?function (\w+)\(([\s\S]*?)\)\s*:\s*[^{]*\{([\s\S]*?)\n\}/g,
		)) {
			out.push({ file, name: m[1]!, params: m[2]!, body: m[3]! });
		}
	}
	return out;
}

/* While the port runs a family takes either handle: the synchronous SQLite
 * `Database` until it is ported, the async `Db` after. */
const declaresHandle = (fn: Fn): boolean => /\bdb: (Database|Db)\b/.test(fn.params);

/** A pure row mapper takes a row and returns a shape; it never reaches a database
 *  and is passed to `.map()`, where a trailing parameter would collide with the
 *  index argument. */
const isMapper = (fn: Fn): boolean => fn.name.startsWith("map");

/** The argument text of every call to `callee` in `body`, paren-balanced so a call
 *  carrying an object or a nested call is read whole rather than cut at its first
 *  comma. */
function callArguments(body: string, callee: string): string[] {
	const out: string[] = [];
	const call = new RegExp(`\\b${callee}\\s*\\(`, "g");
	for (const m of body.matchAll(call)) {
		let depth = 0;
		const start = m.index + m[0].length;
		for (let i = start - 1; i < body.length; i += 1) {
			const ch = body[i];
			if (ch === "(") depth += 1;
			else if (ch === ")") {
				depth -= 1;
				if (depth === 0) {
					out.push(body.slice(start, i));
					break;
				}
			}
		}
	}
	return out;
}

describe("the database handle is always a parameter", () => {
	test("there are family modules to check", () => {
		expect(familyFiles().length).toBeGreaterThan(10);
	});

	test("every data function declares the handle", () => {
		const offenders = exportedFunctions()
			.filter((fn) => !isMapper(fn))
			.filter((fn) => /\bdb\.|openMaleoDb\(\)|openDb\(\)/.test(fn.body))
			.filter((fn) => !declaresHandle(fn))
			.map((fn) => `${fn.file}: ${fn.name}`);
		expect(offenders).toEqual([]);
	});

	test("no function accepts a handle it then ignores", () => {
		const offenders = exportedFunctions()
			.filter(declaresHandle)
			.filter((fn) => !/\bdb\b\s*\.|\bdb\b\s*\)|\bdb\b\s*,/.test(fn.body))
			.map((fn) => `${fn.file}: ${fn.name}`);
		expect(offenders).toEqual([]);
	});

	test("a function that holds a handle forwards it to every family call", () => {
		// Every family function that can accept a handle. A call to one of these from
		// inside a function that holds a handle must pass it on, or the callee falls
		// back to the shared connection and the two halves read different databases.
		const takesHandle = new Set(
			exportedFunctions()
				.filter(declaresHandle)
				.map((fn) => fn.name),
		);
		const offenders: string[] = [];
		for (const fn of exportedFunctions()) {
			if (!declaresHandle(fn)) continue;
			for (const callee of takesHandle) {
				if (callee === fn.name) continue;
				for (const args of callArguments(fn.body, callee)) {
					// `tx` is the transaction handle the function's own `db` opened.
					if (!/\b(db|tx)\b/.test(args))
						offenders.push(`${fn.file}: ${fn.name} -> ${callee}(${args})`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("no family opens the shared connection mid-function", () => {
		// The shared connection may appear only as the parameter default.
		const offenders: string[] = [];
		for (const file of familyFiles()) {
			const src = readFileSync(join(DB_DIR, file), "utf8");
			for (const line of src.split("\n")) {
				if (!line.includes("openDb()") && !line.includes("openDb()")) continue;
				if (line.includes("db: Database = openDb()") || line.includes("db: Db = openDb()"))
					continue;
				if (line.startsWith("import")) continue;
				offenders.push(`${file}: ${line.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
