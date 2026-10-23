/* A tool's declaration and its handler agree.
 *
 * Every tool but one used to declare itself `AnyToolDef` and re-type its args as
 * `Record<string, unknown>`, so the handler hand-coerced fields the executor had
 * already parsed and coerced through the schema three lines above it. Nothing
 * connected the two, and nothing connected either to the `description` string the
 * planner is prompted with — a field added to a schema and not to its description
 * is a field the model never learns it can send.
 *
 * These are declaration-shape tests. The property is about the registry as a
 * whole, which is exactly what no single tool's unit test would see. */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { TOOLS, toolByName, TOOL_ALIAS_CANONICAL } from "./registry.ts";
import { buildToolContext } from "./tool-executor.ts";
import type { AgentJob } from "./model.ts";

/** The keys a tool's schema accepts, for the object schemas that have them. */
function schemaKeys(schema: z.ZodType): string[] {
	// `.strict()` object, possibly wrapped by `.refine()`.
	const inner =
		schema instanceof z.ZodEffects
			? (schema as unknown as { innerType: () => z.ZodType }).innerType()
			: schema;
	const shape = (inner as unknown as { shape?: Record<string, unknown> }).shape;
	return shape ? Object.keys(shape) : [];
}

function job(): AgentJob {
	return {
		id: "run-1",
		projectId: "p1",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		slides: [],
		posts: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "",
		projectRefIds: [],
		startedAt: Date.now(),
	} as unknown as AgentJob;
}

describe("every tool declares what it accepts", () => {
	test("there are tools to check", () => {
		expect(TOOLS.length).toBeGreaterThan(20);
	});

	test("each tool's name is unique, and every alias resolves", () => {
		expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
		for (const [alias, canonical] of Object.entries(TOOL_ALIAS_CANONICAL)) {
			expect({ alias, resolves: toolByName.has(canonical) }).toEqual({ alias, resolves: true });
		}
	});

	test("the description names every argument the schema accepts", () => {
		const missing: string[] = [];
		for (const tool of TOOLS) {
			for (const key of schemaKeys(tool.input)) {
				if (!tool.description.includes(key)) missing.push(`${tool.name}.${key}`);
			}
		}
		// The description is the planner's only spec for a tool. A schema key it does
		// not mention is a key the model is never told about.
		expect(missing).toEqual([]);
	});

	test("a schema key the description does not know about is caught", () => {
		// The guard above only earns its place if it can fail. Prove it can.
		const sneaked = z.object({ knownArg: z.string(), sneakedArg: z.string() }).strict();
		expect(schemaKeys(sneaked).filter((k) => !"tool { knownArg }".includes(k))).toEqual([
			"sneakedArg",
		]);
	});

	test("every handler-bearing tool is a plain async function of (context, args)", async () => {
		// The point of the typed declaration: a tool can be called directly, without
		// the executor, because its handler takes parsed args and a context.
		const viewTimeline = toolByName.get("view_timeline")!;
		const result = await viewTimeline.handler!(buildToolContext(job()), {});
		expect(typeof result.note).toBe("string");
	});
});

describe("the index argument is resolved one way", () => {
	const helpers = buildToolContext(job()).helpers;

	test("an index is rounded and clamped into the list", () => {
		expect(helpers.index(2, 5)).toBe(2);
		expect(helpers.index(9, 5)).toBe(4);
		expect(helpers.index(-3, 5)).toBe(0);
		expect(helpers.index(1.6, 5)).toBe(2);
	});

	test("an absent index means the first item, not the last", () => {
		// The expression this replaced defaulted to -1 before clamping, which is how
		// "no index" became "index 0" — preserved deliberately, and now in one place.
		expect(helpers.index(undefined, 5)).toBe(0);
		expect(helpers.index("nonsense", 5)).toBe(0);
	});

	test("an empty list clamps to 0 rather than -1", () => {
		expect(helpers.index(3, 0)).toBe(0);
	});
});
