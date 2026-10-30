import { expect, test } from "vite-plus/test";
import { editorEngine } from "./engine-registry.ts";
import type { EngineResult } from "./engine.ts";
import type { PreviewMediaDependencies } from "../preview-media-dependencies.ts";

function ok<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

const dependencies: PreviewMediaDependencies = {
	sources: [
		{ id: "source", revision: "r1", url: "/source.mp4", kinds: ["video"], clipIds: ["video"] },
	],
	clips: [{ id: "video", sourceIds: ["source"], blockers: [] }],
};

test("editor WASM holds media readiness without editing document state", () => {
	const engine = editorEngine();
	const doc = ok(
		engine.open(
			JSON.stringify({
				doc: { schemaVersion: 2, clips: [], markers: [] },
				mediaAssets: [],
				slides: [],
				posts: [],
			}),
		),
	);
	const before = ok(engine.read(doc));
	const media = engine.mediaOpen();
	try {
		const update = ok(
			engine.mediaDispatch(media, JSON.stringify({ type: "update", dependencies })),
		);
		expect(JSON.parse(update)).toMatchObject({
			snapshot: { generation: 1, ready: false },
			requests: [{ sourceId: "source", revision: "r1", generation: 1, attempt: 0 }],
		});
		const completed = ok(
			engine.mediaDispatch(
				media,
				JSON.stringify({
					type: "complete",
					request: { sourceId: "source", revision: "r1", generation: 1, attempt: 0 },
					completion: {
						type: "ready",
						eof: true,
						readable: true,
						bytes: 100,
						expected: 100,
						validated: true,
						decoded: true,
					},
				}),
			),
		);
		expect(JSON.parse(completed)).toMatchObject({
			accepted: true,
			snapshot: {
				ready: true,
				clips: [{ id: "video", state: { state: "ready" }, loaded: 100, total: 100 }],
			},
			requests: [],
		});
		expect(ok(engine.read(doc))).toBe(before);
		expect(engine.mediaDispatch(media, '{"type":"update","dependencies":null}').ok).toBe(false);
		expect(JSON.parse(ok(engine.mediaDispatch(media, '{"type":"snapshot"}')))).toMatchObject({
			snapshot: { ready: true },
		});
	} finally {
		ok(engine.mediaClose(media));
		ok(engine.close(doc));
	}
	expect(engine.mediaDispatch(media, '{"type":"snapshot"}').ok).toBe(false);
});
