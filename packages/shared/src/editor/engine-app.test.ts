/* The app-core calls over the WASM ABI (`p1-app-core` task 3.3): each wrapper
 * round-trips through the engine the test preload provides. */
import { describe, expect, test } from "vite-plus/test";
import { editorEngine } from "./engine-registry.ts";
import type { Engine, EngineResult } from "./engine.ts";

const SCOPE = {
	mediaAssets: [],
	slides: [],
	posts: [],
	doc: {
		schemaVersion: 2,
		markers: [],
		clips: [{ id: "text:1", type: "text", startSec: 1, durationSec: 2, track: 0 }],
	},
};
const MOVE = { type: "clip.move", id: "text:1", patch: { startSec: 4 } };
const EMPTY = {
	overlayId: null,
	audioId: null,
	videoOverlayId: null,
	effectId: null,
	transitionId: null,
	freeIds: [],
};

function ok<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
	return result.value;
}

function open(engine: Engine): number {
	return ok(engine.open(JSON.stringify(SCOPE)));
}

const startOf = (engine: Engine, doc: number): number =>
	JSON.parse(ok(engine.read(doc))).doc.clips[0].startSec;

describe("ledger calls", () => {
	test("record, undo, redo and state round-trip on a document handle", () => {
		const engine = editorEngine();
		const doc = open(engine);
		const ledger = engine.ledgerOpen(60);
		ok(engine.executeDelta(doc, JSON.stringify(MOVE)));

		const step = ok(engine.ledgerRecord(ledger, doc, "{}"));
		expect(JSON.parse(ok(engine.ledgerState(ledger)))).toEqual({ undo: [step], redo: [] });

		const undone = JSON.parse(ok(engine.ledgerUndo(ledger, doc)));
		expect(undone.delta.doc.clips[0].startSec).toBe(1);
		expect(startOf(engine, doc)).toBe(1);
		expect(JSON.parse(ok(engine.ledgerState(ledger)))).toEqual({ undo: [], redo: [step] });
		expect(ok(engine.ledgerUndo(ledger, doc))).toBe("null");

		expect(JSON.parse(ok(engine.ledgerRedo(ledger, doc))).delta.doc.clips[0].startSec).toBe(4);
		expect(ok(engine.ledgerRedo(ledger, doc))).toBe("null");

		ok(engine.ledgerClose(ledger));
		expect(engine.ledgerState(ledger)).toMatchObject({
			ok: false,
			error: { kind: "UnknownHandle" },
		});
		ok(engine.close(doc));
	});

	test("recording with nothing executed is refused", () => {
		const engine = editorEngine();
		const doc = open(engine);
		const ledger = engine.ledgerOpen(60);
		expect(engine.ledgerRecord(ledger, doc, "{}")).toMatchObject({
			ok: false,
			error: { kind: "InvalidInput" },
		});
		ok(engine.ledgerClose(ledger));
		ok(engine.close(doc));
	});

	test("an applied change records from both scopes and undoes to the first", () => {
		const engine = editorEngine();
		const ledger = engine.ledgerOpen(60);
		const after = { ...SCOPE, slides: [{ key: "k", id: 1 }] };
		ok(
			engine.ledgerRecordApplied(
				ledger,
				JSON.stringify({
					command: { type: "scope.replace", scope: after },
					inverse: { type: "scope.replace", scope: SCOPE },
					before: SCOPE,
					after,
				}),
			),
		);
		const doc = ok(engine.open(JSON.stringify(after)));
		expect(JSON.parse(ok(engine.ledgerUndo(ledger, doc))).delta.slides).toEqual([]);
		ok(engine.ledgerClose(ledger));
		ok(engine.close(doc));
	});
});

describe("pending calls", () => {
	test("enqueue, rebase, ack and state round-trip; a dropped step cannot be undone", () => {
		const engine = editorEngine();
		const doc = open(engine);
		const ledger = engine.ledgerOpen(60);
		const queue = engine.pendingOpen();
		const inverse = JSON.parse(ok(engine.execute(doc, JSON.stringify(MOVE))));
		ok(engine.ledgerRecord(ledger, doc, "{}"));
		ok(engine.pendingEnqueue(queue, JSON.stringify({ id: "c1", command: MOVE, inverse })));
		expect(JSON.parse(ok(engine.pendingState(queue)))).toEqual([{ id: "c1", type: "clip.move" }]);

		const rebased = JSON.parse(
			ok(
				engine.pendingRebase(
					queue,
					ledger,
					doc,
					JSON.stringify({ delivered: [{ type: "clip.remove", id: "text:1" }] }),
				),
			),
		);
		expect(rebased.delta.doc.clips).toEqual([]);
		expect(rebased.dropped).toEqual([
			{ id: "c1", type: "clip.move", kind: "ClipNotFound", message: expect.any(String) },
		]);
		expect(ok(engine.pendingAck(queue, "c1"))).toBe(false);
		expect(engine.ledgerUndo(ledger, doc)).toMatchObject({
			ok: false,
			error: { kind: "UndoRefused" },
		});

		ok(engine.pendingClose(queue));
		ok(engine.ledgerClose(ledger));
		ok(engine.close(doc));
	});

	test("an acknowledged command leaves the queue", () => {
		const engine = editorEngine();
		const queue = engine.pendingOpen();
		ok(engine.pendingEnqueue(queue, JSON.stringify({ id: "c1", command: MOVE, inverse: MOVE })));
		expect(ok(engine.pendingAck(queue, "c1"))).toBe(true);
		expect(JSON.parse(ok(engine.pendingState(queue)))).toEqual([]);
		ok(engine.pendingClose(queue));
	});

	test("a delivered command that fails is reported as a divergence", () => {
		const engine = editorEngine();
		const doc = open(engine);
		const ledger = engine.ledgerOpen(60);
		const queue = engine.pendingOpen();
		const delivered = { delivered: [{ type: "clip.move", id: "gone", patch: {} }] };
		expect(engine.pendingRebase(queue, ledger, doc, JSON.stringify(delivered))).toMatchObject({
			ok: false,
			error: { kind: "RebaseDelivered" },
		});
		ok(engine.pendingClose(queue));
		ok(engine.ledgerClose(ledger));
		ok(engine.close(doc));
	});
});

describe("selection call", () => {
	test("an action returns the next selection", () => {
		const next = JSON.parse(
			ok(
				editorEngine().selectionApply(
					JSON.stringify({
						selection: EMPTY,
						action: { type: "selectClip", source: "video", refId: 7 },
					}),
				),
			),
		);
		expect(next).toEqual({ ...EMPTY, videoOverlayId: 7, freeIds: ["video:7"] });
	});

	test("an unknown action is refused", () => {
		expect(
			editorEngine().selectionApply(JSON.stringify({ selection: EMPTY, action: { type: "jump" } })),
		).toMatchObject({ ok: false, error: { kind: "InvalidInput" } });
	});
});
