/* Compare mode's Rust frame (OpenSpec p2-render-foundation D8).
 *
 * With `?renderer=compare`, this checks for a WebGPU adapter, imports the
 * renderer module from `/renderer/` (`app/renderer-routes.ts`), supplies every
 * image the preview storyboard draws, and draws the frame at the playhead into
 * the panel's canvas. Without the parameter it does nothing at all, and the
 * module is never requested.
 *
 * One render runs at a time and at most one is scheduled per animation frame,
 * for the latest playhead: a slow frame drops the seeks that arrived while it
 * drew instead of queueing them. A frame's time runs from the call to the GPU
 * finishing its work. No pixels are compared here; the golden corpus does that. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import {
	frameTimes,
	storyboardImageUrls,
	type CoverageEntry,
	type FrameTimes,
} from "@models/timeline/rust-compare.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

/** The renderer module's exports (`crates/renderer-wasm`, wasm-bindgen glue). */
export interface RendererModule {
	default: () => Promise<unknown>;
	init: (canvas: HTMLCanvasElement) => Promise<void>;
	put_image: (url: string, width: number, height: number, rgba: Uint8Array) => void;
	render_to_canvas: (
		storyboardJson: string,
		frame: number,
		width: number,
		height: number,
	) => string;
	work_done: () => Promise<void>;
}

export interface DecodedImage {
	width: number;
	height: number;
	rgba: Uint8Array;
}

/** What the hook reaches outside React for; tests pass fakes. */
export interface RustCompareEnv {
	loadModule: () => Promise<RendererModule>;
	hasAdapter: () => Promise<boolean>;
	decodeImage: (url: string) => Promise<DecodedImage>;
	requestFrame: (run: () => void) => void;
	now: () => number;
}

export type RustCompareState =
	| { status: "off" }
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "error"; message: string }
	| { status: "ready"; times: FrameTimes | null; coverage: CoverageEntry[] };

const MODULE_URL = "/renderer/maleo_renderer_wasm.js";

async function decodeImage(url: string): Promise<DecodedImage> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	const bitmap = await createImageBitmap(await response.blob(), {
		premultiplyAlpha: "none",
		colorSpaceConversion: "none",
	});
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no 2D context to decode images");
	context.drawImage(bitmap, 0, 0);
	const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
	return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(data.buffer) };
}

export const BROWSER_ENV: RustCompareEnv = {
	// A variable, not a literal: the bundler must leave this import to the browser.
	// SAFETY: the module at MODULE_URL is crates/renderer-wasm's wasm-bindgen glue,
	// whose exports `RendererModule` lists.
	loadModule: () => import(/* @vite-ignore */ MODULE_URL) as Promise<RendererModule>,
	hasAdapter: async () => {
		// SAFETY: `navigator.gpu` is absent from this DOM lib; it is read as optional.
		const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
		return Boolean(await gpu?.requestAdapter());
	},
	decodeImage,
	requestFrame: (run) => requestAnimationFrame(run),
	now: () => performance.now(),
};

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useRustCompare(args: {
	enabled: boolean;
	canvas: HTMLCanvasElement | null;
	storyboard: object;
	playhead: PlayheadHandle;
	fps: number;
	width: number;
	height: number;
	env?: RustCompareEnv;
}): RustCompareState {
	const { enabled, canvas, storyboard, playhead, fps, width, height, env = BROWSER_ENV } = args;
	const [state, setState] = useState<RustCompareState>({ status: enabled ? "loading" : "off" });
	const [module, setModule] = useState<RendererModule | null>(null);
	const json = useMemo(() => JSON.stringify(storyboard), [storyboard]);
	const latest = useRef({ json, width, height, fps });
	latest.current = { json, width, height, fps };
	const loop = useRef<{
		pending: number | null;
		scheduled: boolean;
		busy: boolean;
		samples: number[];
	}>({
		pending: null,
		scheduled: false,
		busy: false,
		samples: [],
	});
	const supplied = useRef(new Set<string>());

	useEffect(() => {
		if (!enabled || !canvas) return;
		let live = true;
		void (async () => {
			try {
				if (!(await env.hasAdapter())) {
					if (live) setState({ status: "unavailable" });
					return;
				}
				const loaded = await env.loadModule();
				await loaded.default();
				await loaded.init(canvas);
				if (!live) return;
				setModule(loaded);
				setState({ status: "ready", times: null, coverage: [] });
			} catch (error) {
				if (live) setState({ status: "error", message: message(error) });
			}
		})();
		return () => {
			live = false;
		};
	}, [enabled, canvas, env]);

	const request = useRef((frame: number): void => {
		const run = loop.current;
		run.pending = frame;
		if (run.scheduled || run.busy || !moduleRef.current) return;
		run.scheduled = true;
		env.requestFrame(() => void draw());
	});
	const moduleRef = useRef<RendererModule | null>(null);
	moduleRef.current = module;

	async function draw(): Promise<void> {
		const run = loop.current;
		const renderer = moduleRef.current;
		run.scheduled = false;
		if (!renderer || run.pending == null) return;
		const frame = run.pending;
		run.busy = true;
		try {
			const { json: storyboardJson, width: w, height: h } = latest.current;
			const started = env.now();
			// SAFETY: the module returns its coverage report as a JSON array of entries.
			const coverage = JSON.parse(
				renderer.render_to_canvas(storyboardJson, frame, w, h),
			) as CoverageEntry[];
			await renderer.work_done();
			run.samples.push(env.now() - started);
			setState({ status: "ready", times: frameTimes(run.samples), coverage });
		} catch (error) {
			setState({ status: "error", message: message(error) });
		} finally {
			run.busy = false;
		}
		if (run.pending !== frame) request.current(run.pending);
		else run.pending = null;
	}

	// Every image the storyboard draws, supplied once; a new one redraws the frame.
	useEffect(() => {
		if (!module) return;
		let live = true;
		const missing = storyboardImageUrls(storyboard).filter((url) => !supplied.current.has(url));
		for (const url of missing) {
			supplied.current.add(url);
			env
				.decodeImage(url)
				.then((image) => {
					if (!live) return;
					module.put_image(url, image.width, image.height, image.rgba);
					request.current(Math.round(playhead.get() * latest.current.fps));
				})
				// An image that fails to load stays missing: the frame draws its placeholder.
				.catch(() => {});
		}
		request.current(Math.round(playhead.get() * latest.current.fps));
		return () => {
			live = false;
		};
	}, [module, storyboard, env, playhead]);

	usePlayheadEffect(playhead, (sec) => {
		if (moduleRef.current) request.current(Math.round(sec * latest.current.fps));
	});

	return enabled ? state : { status: "off" };
}
