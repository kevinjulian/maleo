import { beforeAll, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { instantiateEngine, type Engine } from "../packages/shared/src/editor/engine.ts";
import { buildEditorWasm, cargo } from "./editor-engine.mts";

function readinessActions() {
	const source = {
		id: "source",
		revision: "r1",
		url: "/source.mp4",
		kinds: ["video"],
		clipIds: ["clip"],
	};
	const clip = { id: "clip", sourceIds: ["source"], blockers: [] };
	const request = { sourceId: "source", revision: "r1", generation: 1, attempt: 0 };
	const ready = {
		type: "ready",
		eof: true,
		readable: true,
		bytes: 100,
		expected: 100,
		validated: true,
		decoded: true,
	};
	return [
		{ type: "update", dependencies: { sources: [source], clips: [clip] } },
		{ type: "complete", request, completion: { type: "progress", loaded: 40, total: null } },
		{ type: "complete", request, completion: { ...ready, eof: false } },
		{ type: "retry", sourceId: "source" },
		{ type: "complete", request, completion: ready },
		{ type: "complete", request: { ...request, attempt: 1 }, completion: ready },
		{ type: "update", dependencies: { sources: [{ ...source, revision: "r2" }], clips: [clip] } },
		{ type: "complete", request: { ...request, attempt: 1 }, completion: ready },
		{ type: "complete", request: { ...request, revision: "r2", generation: 2 }, completion: ready },
		{
			type: "invalidate",
			request: { ...request, revision: "r2", generation: 2 },
			message: "Local bytes lost",
		},
		{ type: "complete", request: { ...request, revision: "r2", generation: 2 }, completion: ready },
		{ type: "retry", sourceId: "source" },
		{
			type: "invalidate",
			request: { ...request, revision: "r2", generation: 2 },
			message: "Obsolete failure",
		},
		{
			type: "complete",
			request: { ...request, revision: "r2", generation: 2, attempt: 2 },
			completion: ready,
		},
		{ type: "update", dependencies: null },
		{ type: "snapshot" },
		{ type: "update", dependencies: { sources: [], clips: [] } },
		{ type: "complete", request, completion: ready },
	];
}

let native: unknown;
let engine: Engine;
// Cold native/WASM compilation belongs to setup, outside the boundary operation test.
beforeAll(async () => {
	native = JSON.parse(
		cargo(
			["run", "--quiet", "-p", "maleo-editor-wasm", "--bin", "media-parity"],
			JSON.stringify(readinessActions()),
		),
	);
	engine = await instantiateEngine(readFileSync(buildEditorWasm()));
}, 120_000);

test("readiness boundary matches native Rust through progress, Retry, replacement and stale results", () => {
	const handle = engine.mediaOpen();
	try {
		const actual = readinessActions().map((action) => {
			const result = engine.mediaDispatch(handle, JSON.stringify(action));
			return result.ok ? { Ok: result.value } : { Err: JSON.stringify(result.error) };
		});
		expect(actual).toEqual(native);
		expect(actual[5]?.Ok).toContain('"ready":true');
		expect(actual[7]?.Ok).toContain('"accepted":false');
	} finally {
		expect(engine.mediaClose(handle).ok).toBe(true);
	}
});
