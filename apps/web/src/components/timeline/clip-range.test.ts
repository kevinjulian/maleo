/* Maleo's capability policy, which is one function and one asymmetry.
 *
 * Carried over from `content-vui-adapter.test.ts` when the policy moved: the
 * base track's scenes are on the same surface as every other clip now, so the
 * two capability functions became one and its coverage moved with it. The
 * `kind` axis collapsed to `scene` versus `free`, because that asymmetry is the
 * only thing the kind ever decided.
 */
import { describe, expect, test } from "vite-plus/test";
import { clipCapabilities } from "./clip-range.tsx";

const KINDS = ["scene", "free"] as const;
const base = { locked: false, touchUnselected: false, tooNarrowToTrim: false };

describe("clip capabilities", () => {
	test("every kind reports the same editable shape, except the base track's in-point", () => {
		expect(KINDS.map((kind) => [kind, clipCapabilities({ ...base, kind })] as const)).toEqual([
			/* A scene's head is the previous scene's tail — the row is magnetic — so
			   it is rolled rather than trimmed and has no start handle of its own. */
			["scene", { move: true, trimStart: false, trimEnd: true, select: true, readOnly: false }],
			["free", { move: true, trimStart: true, trimEnd: true, select: true, readOnly: false }],
		]);
	});

	test("a locked track makes every kind read-only, and still selectable", () => {
		for (const kind of KINDS) {
			expect(clipCapabilities({ ...base, kind, locked: true })).toEqual({
				move: false,
				trimStart: false,
				trimEnd: false,
				select: true,
				readOnly: true,
			});
		}
	});

	test("a clip too narrow for body-plus-handles offers no trim, and still moves", () => {
		expect(
			KINDS.map(
				(kind) => [kind, clipCapabilities({ ...base, kind, tooNarrowToTrim: true })] as const,
			),
		).toEqual(
			KINDS.map((kind) => [
				kind,
				{ move: true, trimStart: false, trimEnd: false, select: true, readOnly: false },
			]),
		);
	});

	/* Selection is a mode on a coarse pointer. An unselected clip declines the
	 * gesture entirely so the press falls through to the browser's pan; it is
	 * still selectable, and still not read-only — the clip is editable, the
	 * operator has just not said yet that this is the one they mean. */
	test("an unselected clip under a coarse pointer declines move and trim, but stays selectable and editable", () => {
		expect(
			KINDS.map(
				(kind) => [kind, clipCapabilities({ ...base, kind, touchUnselected: true })] as const,
			),
		).toEqual(
			KINDS.map((kind) => [
				kind,
				{ move: false, trimStart: false, trimEnd: false, select: true, readOnly: false },
			]),
		);
	});
});
