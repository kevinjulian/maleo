import { describe, expect, test } from "vite-plus/test";
import { createCommandLedger } from "./command-ledger.ts";
import {
	engineExecutor,
	insertClip,
	insertPost,
	insertSlide,
	moveClip,
	removeClip,
	replaceScope,
	updateClip,
	type CommandExecutor,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import type { Clip } from "@maleo/shared";
import { testEngine as engine } from "@models/editor-engine/engine-fixture.ts";

/* Image/text editing, whole-scope replacement and undo/redo run through the
 * Rust engine the editor uses. */
const EXECUTORS: [string, () => CommandExecutor][] = [["engine", () => engineExecutor(engine)]];

const clip = (id: string): Clip => ({ id, type: "text", startSec: 0, durationSec: 1, track: 0 });
const scope = (ids: string[]): EditScope => ({
	doc: { schemaVersion: 2, clips: ids.map(clip), markers: [] },
	slides: [],
	posts: [],
	mediaAssets: [],
});

for (const [name, executorOf] of EXECUTORS) {
	const executor = executorOf();

	// Drive a ledger the way the hook does: execute, then record(command, before, gesture, executed).
	function apply(
		ledger: ReturnType<typeof createCommandLedger>,
		before: EditScope,
		cmd: EditorCommand,
	): EditScope {
		const executed = executor.execute(before, cmd);
		ledger.record(cmd, before, undefined, executed);
		return executed.scope;
	}

	describe(`command ledger (${name} executor)`, () => {
		test("undo inverts the last command; redo re-applies it", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope([]);
			const s1 = apply(ledger, s0, insertClip(clip("text:1")));
			expect(ledger.canUndo()).toBe(true);
			expect(ledger.canRedo()).toBe(false);

			const undone = ledger.undo(s1);
			expect(undone).toEqual(s0);
			expect(ledger.canUndo()).toBe(false);
			expect(ledger.canRedo()).toBe(true);

			const redone = ledger.redo(undone!);
			expect(redone).toEqual(s1);
			expect(ledger.canRedo()).toBe(false);
		});

		test("a new command clears the redo stack", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope(["text:1"]);
			const s1 = apply(ledger, s0, removeClip("text:1"));
			const back = ledger.undo(s1)!; // redo now available
			expect(ledger.canRedo()).toBe(true);
			apply(ledger, back, insertClip(clip("text:9")));
			expect(ledger.canRedo()).toBe(false); // new edit wiped redo
		});

		test("undo/redo across a multi-step history returns to each prior state", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope([]);
			const s1 = apply(ledger, s0, insertClip(clip("text:1")));
			const s2 = apply(ledger, s1, insertClip(clip("text:2")));
			const s3 = apply(ledger, s2, insertClip(clip("text:3")));
			expect(s3.doc.clips.map((c) => c.id)).toEqual(["text:1", "text:2", "text:3"]);
			const u1 = ledger.undo(s3)!;
			expect(u1).toEqual(s2);
			const u2 = ledger.undo(u1)!;
			expect(u2).toEqual(s1);
			expect(ledger.redo(u2)!).toEqual(s2);
		});

		test("replaceScope edits invert to the recorded baseline", () => {
			const ledger = createCommandLedger(executor);
			const base = scope(["text:1"]);
			const edited = scope(["text:1", "text:2"]);
			ledger.record(replaceScope(edited), base); // watcher-style record
			expect(ledger.undo(edited)).toEqual(base);
		});

		test("undo/redo works for image slides and text posts without a clips document", () => {
			const ledger = createCommandLedger(executor);
			const s0: EditScope = {
				doc: { schemaVersion: 2, clips: [], markers: [] },
				slides: [],
				posts: [],
				mediaAssets: [],
			};
			const s1 = apply(
				ledger,
				s0,
				insertSlide({ key: "slide_t1", id: 1, cap: "Slide caption", vis: "Hero shot", img: false }),
			);
			const s2 = apply(
				ledger,
				s1,
				insertPost({ key: "post_t1", id: 1, body: "Post body", img: false }),
			);

			expect(s2.doc.clips).toEqual([]);
			expect(s2.slides).toHaveLength(1);
			expect(s2.posts).toHaveLength(1);
			const withoutPost = ledger.undo(s2);
			expect(withoutPost).toEqual(s1);
			const withoutSlide = ledger.undo(withoutPost!);
			expect(withoutSlide).toEqual(s0);
			const withSlideAgain = ledger.redo(withoutSlide!);
			expect(withSlideAgain).toEqual(s1);
			expect(ledger.redo(withSlideAgain!)).toEqual(s2);
		});

		// Regression: the ledger computes the inverse EAGERLY at record time, so a
		// clip command (updateClip/replaceClip) must be recorded against the exact
		// `before` it targets. During a burst of streaming agent commits the hook's
		// render-mirrored scope lags a tick behind the live store; recording a
		// clip-update against that stale scope made the eager inverse look for a clip
		// absent from prior state and threw. The fix threads the diffed `before`
		// through `run`; these tests pin both sides of that invariant.
		test("clip-update inverts cleanly when recorded against the before it targets", () => {
			const ledger = createCommandLedger(executor);
			const before = scope(["scene:1784841068223"]);
			const cmd = updateClip("scene:1784841068223", { durationSec: 2 });
			const after = executor.execute(before, cmd).scope;
			expect(() => ledger.record(cmd, before)).not.toThrow();
			expect(ledger.undo(after)).toEqual(before);
		});

		test("recording a clip-update against a stale before missing the clip throws", () => {
			const ledger = createCommandLedger(executor);
			const stale = scope([]); // lagging scope: the clip isn't here yet
			expect(() =>
				ledger.record(updateClip("scene:1784841068223", { durationSec: 2 }), stale),
			).toThrow(); // refusal preserves history
		});

		test("undo on empty history is a no-op (null)", () => {
			const ledger = createCommandLedger(executor);
			expect(ledger.undo(scope([]))).toBeNull();
			expect(ledger.redo(scope([]))).toBeNull();
		});

		test("history is capped at the limit", () => {
			const ledger = createCommandLedger(executor, 3);
			let s = scope([]);
			for (let i = 0; i < 10; i++) s = apply(ledger, s, insertClip(clip(`text:${i}`)));
			expect(ledger.depths().undo).toBe(3);
		});
	});

	/* One continuous interaction is one undo step.
	 *
	 * A drag emits a command per animation frame -- `use-clip-drag` calls `apply`
	 * from an rAF loop -- and its drop emits one more per relocated clip. Recorded
	 * individually against a 60-entry stack, a single sustained drag filled the
	 * ledger and evicted the entire undo history, and undo then walked back through
	 * the drag one frame at a time. */
	describe("a gesture collapses into one undo step", () => {
		const at = (ids: string[], start: number): EditScope => ({
			doc: {
				schemaVersion: 2,
				clips: ids.map((id) => ({ ...clip(id), startSec: start })),
				markers: [],
			},
			slides: [],
			posts: [],
			mediaAssets: [],
		});

		test("sixty frames of one drag leave one entry, and undo returns to the start", () => {
			const ledger = createCommandLedger(executor);
			const start = at(["text:1"], 0);
			let current = start;
			for (let frame = 1; frame <= 60; frame++) {
				const cmd = moveClip("text:1", { startSec: frame });
				ledger.record(cmd, current, "drag-1");
				current = executor.execute(current, cmd).scope;
			}

			expect(ledger.depths().undo).toBe(1);
			expect(current.doc.clips[0]!.startSec).toBe(60);
			// Inverts to where the DRAG began, not to the frame before the last one.
			expect(ledger.undo(current)!.doc.clips[0]!.startSec).toBe(0);
		});

		/* The case the collapse was NOT written for. Its comment describes a drag
		 * emitting a command per frame, every frame targeting one clip — there,
		 * inverting the newest command against the gesture's start restores it
		 * completely. A gesture that spans several clips has no such property: the
		 * newest command knows about one clip, and the rest of the gesture is gone.
		 *
		 * Seven operations batch this way — paste, duplicate, delete, ripple delete,
		 * z-order reorder, organize-range and track reorder. */
		test("a gesture that moves three clips undoes all three", () => {
			const ledger = createCommandLedger(executor);
			const start = at(["text:1", "text:2", "text:3"], 0);
			let current = start;
			for (const id of ["text:1", "text:2", "text:3"]) {
				const cmd = moveClip(id, { startSec: 9 });
				ledger.record(cmd, current, "reorder-1");
				current = executor.execute(current, cmd).scope;
			}

			expect(ledger.depths().undo).toBe(1);
			expect(current.doc.clips.map((c) => c.startSec)).toEqual([9, 9, 9]);
			// One undo returns the batch to where it started — every clip, not just
			// the last one the batch happened to touch.
			expect(ledger.undo(current)!.doc.clips.map((c) => c.startSec)).toEqual([0, 0, 0]);
		});

		/* Redo is the same defect mirrored: a collapsed entry that kept only the
		 * newest command re-applied one clip. */
		test("redoing a three-clip gesture restores all three", () => {
			const ledger = createCommandLedger(executor);
			const start = at(["text:1", "text:2", "text:3"], 0);
			let current = start;
			for (const id of ["text:1", "text:2", "text:3"]) {
				const cmd = moveClip(id, { startSec: 9 });
				ledger.record(cmd, current, "reorder-2");
				current = executor.execute(current, cmd).scope;
			}

			const undone = ledger.undo(current)!;
			expect(undone.doc.clips.map((c) => c.startSec)).toEqual([0, 0, 0]);
			expect(ledger.redo(undone)!.doc.clips.map((c) => c.startSec)).toEqual([9, 9, 9]);
		});

		test("without a gesture the same frames are sixty entries", () => {
			// The behaviour that made this necessary; kept so the coalescing is not
			// mistaken for something the ledger did all along.
			const ledger = createCommandLedger(executor);
			let current = at(["text:1"], 0);
			for (let frame = 1; frame <= 60; frame++) {
				const cmd = moveClip("text:1", { startSec: frame });
				ledger.record(cmd, current);
				current = executor.execute(current, cmd).scope;
			}
			expect(ledger.depths().undo).toBe(60);
		});

		test("a drag does not swallow the edit before it", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope([]);
			const s1 = apply(ledger, s0, insertClip(clip("text:1")));

			let current = s1;
			for (const frame of [1, 2, 3]) {
				const cmd = moveClip("text:1", { startSec: frame });
				ledger.record(cmd, current, "drag-2");
				current = executor.execute(current, cmd).scope;
			}

			expect(ledger.depths().undo).toBe(2);
			expect(ledger.undo(current)).toEqual(s1); // undo the drag
			expect(ledger.undo(s1)).toEqual(s0); // undo the insert
		});

		test("two drags are two steps", () => {
			const ledger = createCommandLedger(executor);
			let current = at(["text:1"], 0);
			for (const g of ["drag-a", "drag-b"]) {
				for (const frame of [1, 2]) {
					const cmd = moveClip("text:1", { startSec: g === "drag-a" ? frame : frame + 10 });
					ledger.record(cmd, current, g);
					current = executor.execute(current, cmd).scope;
				}
			}
			expect(ledger.depths().undo).toBe(2);
		});

		test("a gesture still clears redo, like any other edit", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope(["text:1"]);
			const s1 = apply(ledger, s0, removeClip("text:1"));
			ledger.undo(s1);
			expect(ledger.canRedo()).toBe(true);
			ledger.record(insertClip(clip("text:2")), s0, "drag-3");
			expect(ledger.canRedo()).toBe(false);
		});
	});

	describe("latestStep", () => {
		test("names the step the next undo reverses, and nothing after it moves on", () => {
			const ledger = createCommandLedger(executor);
			expect(ledger.latestStep()).toBeNull();
			const base: EditScope = {
				doc: { schemaVersion: 2, clips: [], markers: [] } as unknown as EditScope["doc"],
				slides: [],
				posts: [],
				mediaAssets: [],
			};
			const first = replaceScope(
				{ ...base, slides: [{ key: "k1", id: 1, cap: "a", vis: "", img: false }] },
				"agent.slides",
			);
			const firstStep = ledger.record(first, base);
			expect(ledger.latestStep()).toBe(firstStep);
			const second = replaceScope(base, "user.edit");
			const secondStep = ledger.record(second, executor.execute(base, first).scope);
			expect(ledger.latestStep()).toBe(secondStep);
			ledger.undo(base);
			expect(ledger.latestStep()).toBe(firstStep);
		});

		test("two equal commands recorded as separate steps are told apart", () => {
			// Command data carries no identity, so two structurally equal edits must
			// not answer "is this still the latest" for each other.
			const ledger = createCommandLedger(executor);
			const s0 = scope(["text:1"]);
			const earlier = ledger.record(moveClip("text:1", { startSec: 3 }), s0);
			const s1 = executor.execute(s0, moveClip("text:1", { startSec: 3 })).scope;
			const later = ledger.record(moveClip("text:1", { startSec: 3 }), s1);
			expect(earlier).not.toBe(later);
			expect(ledger.latestStep()).toBe(later);
			ledger.undo(s1);
			expect(ledger.latestStep()).toBe(earlier);
		});

		test("a gesture that collapses into the top entry gets a new step id", () => {
			const ledger = createCommandLedger(executor);
			const s0 = scope(["text:1"]);
			const first = ledger.record(moveClip("text:1", { startSec: 1 }), s0, "drag");
			const collapsed = ledger.record(
				moveClip("text:1", { startSec: 2 }),
				executor.execute(s0, moveClip("text:1", { startSec: 1 })).scope,
				"drag",
			);
			expect(collapsed).not.toBe(first);
			expect(ledger.latestStep()).toBe(collapsed);
		});

		test("a settled whole-plan result applies as one step and undoes to the prior image, text and video state", () => {
			const ledger = createCommandLedger(executor);
			const s0: EditScope = {
				...scope(["text:1"]),
				slides: [{ key: "slide_a", id: 1, cap: "Before", vis: "Wide", img: false }],
				posts: [{ key: "post_a", id: 1, body: "Before", img: false }],
			};
			const plan: EditScope = {
				...scope(["text:1", "text:2"]),
				slides: [
					{
						key: "slide_a",
						id: 1,
						cap: "After",
						vis: "Wide",
						img: false,
						name: "Added by the plan",
					},
					{ key: "slide_b", id: 2, cap: "New", vis: "Close", img: false },
				],
				posts: [{ key: "post_a", id: 1, body: "After", img: false }],
			};
			const s1 = apply(ledger, s0, replaceScope(plan, "agent.plan"));
			expect(s1).toEqual(plan);
			const undone = ledger.undo(s1)!;
			expect(undone).toEqual(s0);
			expect(ledger.canUndo()).toBe(false);
			expect(ledger.redo(undone)).toEqual(plan);
		});
	});
}
