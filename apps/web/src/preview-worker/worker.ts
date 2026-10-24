/* The preview worker (OpenSpec p2-preview-runtime D5): the engine's preview
 * session (`crates/renderer-wasm`) on the canvas the page transferred here, so a
 * slow frame never blocks the editor. It loads the renderer module from
 * `/renderer/`, runs the protocol in `models/timeline/preview-protocol.ts`,
 * fetches and decodes the storyboard's images itself, and ticks the session
 * from its own `requestAnimationFrame` only while playing or while a draw is
 * pending. It posts one state message per drawn frame, plus one for a play,
 * a pause, a refused request or a device change, none of which draw.
 *
 * Not part of the app bundle: `scripts/build-renderer-wasm.ts` bundles it to
 * `target/renderer-wasm/preview-worker.js`, served at `/renderer/` and loaded
 * only in compare mode. */
import type { PreviewRequest, PreviewState } from "@models/timeline/preview-protocol.ts";
import { previewNow } from "@models/timeline/preview-protocol.ts";

/** The session exports of `crates/renderer-wasm` (wasm-bindgen glue). */
interface SessionModule {
	default: () => Promise<unknown>;
	init: (canvas: OffscreenCanvas, onChange: () => void) => Promise<void>;
	set_storyboard: (json: string, fps: number, durationFrames: number) => void;
	seek: (position: number, now: number) => void;
	play: (position: number, at: number, rate: number) => void;
	pause: (position: number) => void;
	resize: (width: number, height: number) => void;
	put_image: (url: string, width: number, height: number, rgba: Uint8Array) => void;
	report_remotion: (position: number, at: number) => void;
	tick: (now: number) => Promise<boolean>;
	wants_tick: (now: number) => boolean;
	state: (now: number) => string;
	lose_device: () => void;
}

/** The worker global this module runs in; the app's DOM lib has no worker scope. */
interface WorkerScope {
	onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null;
	postMessage: (message: unknown) => void;
	requestAnimationFrame: (run: () => void) => number;
	loseDevice?: () => void;
}

// SAFETY: this module runs only as a dedicated worker's entry, whose global has these members.
const scope = globalThis as WorkerScope;
const MODULE_URL = "/renderer/maleo_renderer_wasm.js";

let session: SessionModule | null = null;
let fps = 30;
let looping = false;
let error: string | null = null;
const supplied = new Set<string>();

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function post(state?: Partial<PreviewState>): void {
	// SAFETY: `state()` returns the session report `PreviewState` describes, less `error`.
	const report = session ? (JSON.parse(session.state(previewNow())) as PreviewState) : null;
	scope.postMessage({ type: "state", state: { ...report, ...state, error } });
}

function kick(): void {
	if (looping || !session) return;
	looping = true;
	scope.requestAnimationFrame(loop);
}

function loop(): void {
	const live = session;
	if (!live) return;
	live
		.tick(previewNow())
		.then((drawn) => {
			if (drawn) post();
		})
		.catch((cause: unknown) => {
			error = message(cause);
			post();
		});
	if (live.wants_tick(previewNow())) scope.requestAnimationFrame(loop);
	else looping = false;
}

async function decode(url: string): Promise<{ width: number; height: number; rgba: Uint8Array }> {
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

/** Supplies every image the storyboard draws, once; each one redraws the frame. */
function supplyImages(live: SessionModule, urls: readonly string[]): void {
	for (const url of urls) {
		if (supplied.has(url)) continue;
		supplied.add(url);
		decode(url)
			.then((image) => {
				live.put_image(url, image.width, image.height, image.rgba);
				kick();
			})
			// An image that fails to load stays missing: the frame draws its placeholder.
			.catch(() => {});
	}
}

async function start(canvas: OffscreenCanvas): Promise<void> {
	try {
		// A variable, not a literal: the bundler must leave this import to the browser.
		// SAFETY: the module at MODULE_URL is crates/renderer-wasm's glue, whose exports `SessionModule` lists.
		const loaded = (await import(/* @vite-ignore */ MODULE_URL)) as SessionModule;
		await loaded.default();
		await loaded.init(canvas, () => {
			post();
			kick();
		});
		session = loaded;
		// Debug: `loseDevice()` from the worker's console exercises recovery (D6).
		scope.loseDevice = () => loaded.lose_device();
		post();
	} catch (cause) {
		post({ status: "failed", message: message(cause) });
	}
}

function handle(request: PreviewRequest, live: SessionModule): void {
	const now = previewNow();
	switch (request.type) {
		case "init":
			return;
		case "storyboard":
			live.set_storyboard(request.json, request.fps, request.durationFrames);
			fps = request.fps;
			supplyImages(live, request.images);
			return;
		case "seek":
			return live.seek(request.frame / fps, now);
		case "play":
			return live.play(request.position, request.at, request.rate);
		case "pause":
			return live.pause(request.position);
		case "remotion":
			return live.report_remotion(request.position, request.at);
		case "resize":
			return live.resize(request.width, request.height);
	}
}

/* Requests run in order: those that arrive while the module loads wait for it. */
let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
	queue = queue.then(async () => {
		if (data.type === "init") return start(data.canvas);
		if (!session) return;
		const before = error;
		try {
			handle(data, session);
			error = null;
		} catch (cause) {
			// A refused request (a storyboard that does not parse) keeps the previous input.
			error = message(cause);
		}
		// Play and pause change the status without drawing; the rest report with their frame.
		if (data.type === "play" || data.type === "pause" || error !== before) post();
		kick();
	});
};
