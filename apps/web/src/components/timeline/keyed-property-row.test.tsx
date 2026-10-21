// @vitest-environment happy-dom
/* Per-row keyframe controls (timeline-edit-commands: value-adjacent keyframe
 * controls), driven through the real inspector rows, document store and writers. */
import { afterEach, expect, test } from "vite-plus/test";
import type { Animation } from "@maleo/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { toTimelineDoc } = await import("@maleo/shared");
const { createTimelineDocumentStore, useDocumentSelector } =
	await import("@stores/timeline-document-store.ts");
const { createDocumentWriters } = await import("@stores/document-writers.ts");
const { createPlayheadHandle } = await import("@models/timeline/playhead-handle.ts");
const { patchCanvasLayout } = await import("@models/timeline/canvas-transform.ts");
const { clipAnimationInfo } = await import("@models/timeline/clip-animation-edit.ts");
const { TransformSection } = await import("./clip-canvas.tsx");
const { KeyGesture, useClipKeying } = await import("./keyed-property-row.tsx");

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
});

function setup(animation?: Animation) {
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "image",
				url: "image.png",
				start: 0,
				dur: 4,
				layout: {
					xPct: 0,
					yPct: 0,
					widthPct: 50,
					heightPct: 50,
					fit: "contain",
					aspectLocked: true,
					...(animation ? { animation } : {}),
				},
			},
		],
	);
	const store = createTimelineDocumentStore(doc),
		playhead = createPlayheadHandle(0),
		gestures: string[] = [];
	const writers = createDocumentWriters({
		store,
		commit: (next) => store.setDoc(next),
		gesture: { begin: () => gestures.push("begin"), end: () => gestures.push("end") },
	});
	const target = { source: "video", id: 2 } as const;
	function Harness() {
		const layout = useDocumentSelector(store, (s) => s.deriveArrays().videoOverlays[0]?.layout);
		const { rowKeying } = useClipKeying({ target, store, writers, playhead, fps: 30 });
		return (
			<KeyGesture writers={writers}>
				<TransformSection
					layout={layout}
					kind="image"
					keying={rowKeying}
					onChange={(p) => writers.mutate((d) => patchCanvasLayout(d, target, p))}
				/>
			</KeyGesture>
		);
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(<Harness />));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	const tracks = () => clipAnimationInfo(store.getDoc(), target)?.animation?.tracks;
	const layout = () => store.deriveArrays().videoOverlays[0]?.layout;
	const button = (name: string) =>
		host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
	const field = (name: string) =>
		host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
	const type = (input: HTMLInputElement, value: number) =>
		act(() => {
			input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
				input,
				String(value),
			);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
		});
	const seek = (seconds: number) => act(() => playhead.set(seconds));
	return { store, playhead, gestures, tracks, layout, button, field, type, seek };
}

test("the key toggle adds a key at the playhead, and a later value edit keys that time", () => {
	const ui = setup();
	expect(ui.button("Rotation keyframe")?.getAttribute("aria-pressed")).toBe("false");
	act(() => ui.button("Rotation keyframe")!.click());
	expect(ui.tracks()?.rotationDeg).toEqual([{ t: 0, v: 0, easing: "linear" }]);
	expect(ui.button("Rotation keyframe")?.getAttribute("aria-pressed")).toBe("true");
	ui.seek(2);
	ui.type(ui.field("Rotation"), 45);
	expect(ui.tracks()?.rotationDeg).toEqual([
		{ t: 0, v: 0, easing: "linear" },
		{ t: 2, v: 45, easing: "linear" },
	]);
	expect(ui.gestures.filter((g) => g === "begin").length).toBe(
		ui.gestures.filter((g) => g === "end").length,
	);
});

test("the toggle precedes its label and is unavailable outside the clip, while static edits stay allowed", () => {
	const ui = setup();
	const row = ui.button("Position keyframe")!.closest('[data-slot="property-row"]')!;
	const order = [
		...row.querySelectorAll('button[aria-label="Position keyframe"], .ui-insp-label'),
	].map((el) => el.tagName);
	expect(order).toEqual(["BUTTON", "SPAN"]);
	ui.seek(9);
	expect(ui.button("Position keyframe")!.disabled).toBe(true);
	ui.type(ui.field("X offset"), 30);
	expect(ui.tracks()?.xPct).toBeUndefined();
	expect(clipAnimationInfo(ui.store.getDoc(), { source: "video", id: 2 })?.values.xPct).toBe(30);
});

test("arming a property then editing it later keys both times", () => {
	const ui = setup();
	act(() => ui.button("Rotation keyframe")!.click());
	ui.seek(2);
	ui.type(ui.field("Rotation"), -30);
	expect(ui.tracks()?.rotationDeg).toEqual([
		{ t: 0, v: 0, easing: "linear" },
		{ t: 2, v: -30, easing: "linear" },
	]);
});

test("a locked Size row is driven by width: height follows the ratio and is not editable; unlocked, both edit alone", () => {
	const ui = setup();
	expect(ui.field("Height").disabled).toBe(true);
	ui.type(ui.field("Width"), 60);
	expect(ui.layout()).toMatchObject({ widthPct: 60, heightPct: 60 });
	expect(ui.field("Scale" as string)).toBeNull();
	act(() => ui.button("Lock aspect ratio")!.click());
	expect(ui.field("Height").disabled).toBe(false);
	ui.type(ui.field("Width"), 20);
	expect(ui.layout()).toMatchObject({ widthPct: 20, heightPct: 60 });
});

test("a locked, keyed Size row keys width and height together at the ratio", () => {
	const doc = toTimelineDoc(
		[],
		[],
		[
			{
				id: 5,
				content: "Title",
				start: 0,
				dur: 4,
				preset: "title",
				style: { fontFamily: "Inter", fontSize: 48, weight: 800, fill: "#ffffff", align: "center" },
				layout: {
					xPct: 0,
					yPct: 0,
					widthPct: 50,
					heightPct: 25,
					fit: "contain",
					aspectLocked: true,
					animation: { tracks: { widthPct: [{ t: 0, v: 50 }], heightPct: [{ t: 0, v: 25 }] } },
				},
			},
		],
	);
	const store = createTimelineDocumentStore(doc),
		playhead = createPlayheadHandle(2);
	const writers = createDocumentWriters({
		store,
		commit: (next) => store.setDoc(next),
		gesture: { begin: () => {}, end: () => {} },
	});
	const target = { source: "text", id: 5 } as const;
	function Harness() {
		const layout = useDocumentSelector(store, (s) => s.deriveArrays().textOverlays[0]?.layout);
		const { rowKeying } = useClipKeying({ target, store, writers, playhead, fps: 30 });
		return (
			<TransformSection
				layout={layout}
				kind="text"
				keying={rowKeying}
				onChange={(p) => writers.mutate((d) => patchCanvasLayout(d, target, p))}
			/>
		);
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(<Harness />));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	const width = host.querySelector<HTMLInputElement>('input[aria-label="Width"]')!;
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(width, "80");
		width.dispatchEvent(new Event("input", { bubbles: true }));
	});
	const tracks = clipAnimationInfo(store.getDoc(), target)?.animation?.tracks;
	expect(tracks?.widthPct?.find((k) => k.t === 2)?.v).toBe(80);
	expect(tracks?.heightPct?.find((k) => k.t === 2)?.v).toBe(40);
});

test("an unkeyed row on an animated clip edits the static value", () => {
	const ui = setup({
		tracks: {
			scale: [
				{ t: 0, v: 1 },
				{ t: 4, v: 2 },
			],
		},
	});
	ui.seek(1);
	ui.type(ui.field("Y offset"), 30);
	expect(ui.tracks()?.yPct).toBeUndefined();
	expect(ui.tracks()?.scale).toHaveLength(2);
	expect(clipAnimationInfo(ui.store.getDoc(), { source: "video", id: 2 })?.values.yPct).toBe(30);
	expect(ui.button("Position keyframe")?.getAttribute("aria-pressed")).toBe("false");
});

/* Row keying (keyframe-animation: one toggle per row), driven through the hook. */
function rowSetup(animation?: Animation) {
	const doc = toTimelineDoc(
		[],
		[
			{
				id: 2,
				kind: "image",
				url: "image.png",
				start: 0,
				dur: 4,
				layout: {
					xPct: 10,
					yPct: 20,
					widthPct: 50,
					heightPct: 50,
					fit: "contain",
					...(animation ? { animation } : {}),
				},
			},
		],
	);
	const store = createTimelineDocumentStore(doc),
		playhead = createPlayheadHandle(0),
		commits = { n: 0 };
	const writers = createDocumentWriters({
		store,
		commit: (next) => {
			commits.n += 1;
			store.setDoc(next);
		},
		gesture: { begin: () => {}, end: () => {} },
	});
	const target = { source: "video", id: 2 } as const;
	const latest: { row?: ReturnType<ReturnType<typeof useClipKeying>["rowKeying"]> } = {};
	function Harness() {
		useDocumentSelector(store, (s) => s.getDoc());
		latest.row = useClipKeying({ target, store, writers, playhead, fps: 30 }).rowKeying([
			"xPct",
			"yPct",
		]);
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	act(() => root.render(<Harness />));
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	return {
		store,
		commits,
		row: () => latest.row!,
		seek: (s: number) => act(() => playhead.set(s)),
		tracks: () => clipAnimationInfo(store.getDoc(), target)?.animation?.tracks,
		values: () => clipAnimationInfo(store.getDoc(), target)?.values,
	};
}

test("turning a row toggle on keys every row property at the playhead with its current value; off removes them", () => {
	const ui = rowSetup();
	ui.seek(1);
	expect(ui.row().keyed).toBe(false);
	act(() => ui.row().toggle());
	expect(ui.tracks()?.xPct).toEqual([{ t: 1, v: 10, easing: "linear" }]);
	expect(ui.tracks()?.yPct).toEqual([{ t: 1, v: 20, easing: "linear" }]);
	expect(ui.row().keyed).toBe(true);
	act(() => ui.row().toggle());
	expect(ui.tracks()?.xPct ?? []).toEqual([]);
	expect(ui.tracks()?.yPct ?? []).toEqual([]);
});

test("editing one field of an animated row keys its partner at the sampled value, in one undo step", () => {
	const ui = rowSetup({
		tracks: {
			xPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 40 },
			],
			yPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 80 },
			],
		},
	});
	ui.seek(3);
	act(() =>
		ui.row().setValues({ xPct: 99 }, () => {
			throw new Error("static write on an animated row");
		}),
	);
	expect(ui.tracks()?.xPct?.find((k) => k.t === 3)?.v).toBe(99);
	expect(ui.tracks()?.yPct?.find((k) => k.t === 3)?.v).toBe(60);
	expect(ui.commits.n).toBe(1);
});

test("a row without keys edits static values, and its toggle is unavailable outside the clip", () => {
	const ui = rowSetup();
	let wrote: number | undefined;
	act(() =>
		ui.row().setValues({ yPct: 33 }, () => {
			wrote = 33;
		}),
	);
	expect(wrote).toBe(33);
	expect(ui.tracks()?.yPct).toBeUndefined();
	ui.seek(9);
	expect(ui.row().toggleDisabled).toBe(true);
	expect(ui.row().valueDisabled).toBe(false);
});
