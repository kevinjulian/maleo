/* The Rust editor engine (`crates/editor-core`) as a TS object, over the raw
 * WebAssembly ABI in `crates/editor-wasm/src/lib.rs`.
 *
 * Pure in the sense this package requires: it instantiates bytes the caller
 * already has (a browser fetch, a Bun file read) and performs no IO itself. The
 * module imports nothing, so it cannot reach any host API either.
 *
 * A document is opened once and held inside the engine behind a handle;
 * `execute` returns only the inverse, so an edit never copies the document
 * across the boundary. `read` returns the whole scope, for a save. */

export interface EngineError {
	kind: string;
	message: string;
}

export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: EngineError };

export interface Engine {
	/** Admit a scope (JSON text) and hold it; returns its handle. */
	open(scopeJson: string): EngineResult<number>;
	/** Execute a command (JSON text) against the handle's scope; returns the inverse's JSON. */
	execute(handle: number, commandJson: string): EngineResult<string>;
	/** Execute like `execute`; returns `{"inverse": …, "delta": …}`, the delta naming
	 *  only the parts of the scope the edit replaced (see `engine-executor.ts`). */
	executeDelta(handle: number, commandJson: string): EngineResult<string>;
	/** The handle's current scope, as `JSON.stringify` would write it. */
	read(handle: number): EngineResult<string>;
	close(handle: number): EngineResult<void>;
	/** Stateless: admit both, execute, return `{"scope": …, "inverse": …}`. */
	executeOnce(scopeJson: string, commandJson: string): EngineResult<string>;
	/** Content-timebase ticks (30 fps × 1000), half away from zero; NaN when unrepresentable. */
	secondsToTicks(seconds: number): number;
	openCount(): number;
	/* Edit-policy gestures (task 4.2). The base state crosses once, at open; each
	 * pointer sample sends only the update and receives only the projection. */
	/** Open a move or trim transaction over `stateJson`; `beginJson` is `{"id", "intent"}`. */
	gestureOpen(stateJson: string, beginJson: string): EngineResult<number>;
	/** Refine the projection with one sample; returns the projection's JSON. */
	gestureUpdate(handle: number, updateJson: string): EngineResult<string>;
	/** End by committing: `{"ok": true, "operation"?}` or `{"ok": false, "rejection"}`. */
	gestureCommit(handle: number): EngineResult<string>;
	gestureRollback(handle: number): EngineResult<string>;
	gestureClose(handle: number): EngineResult<void>;
	gestureOpenCount(): number;
	/** `frames` as timecode at a frame rate (numerator/denominator) and ticks per frame; drop-frame when asked. */
	formatTimecode(
		frames: number,
		rate: { numerator: number; denominator: number },
		ticksPerFrame: number,
		dropFrame: boolean,
	): EngineResult<string>;
	/** Snap outside a gesture: `{ticks, candidates, thresholdPx, scale, bypass?, moving?}` → `{ticks, candidate}`. */
	snap(requestJson: string): EngineResult<string>;
	/* App-core (`p1-app-core` D2): undo ledgers and pending queues have their own
	 * handles; a call that touches the document also names the document handle. */
	/** Open an undo ledger holding at most `limit` steps; returns its handle. */
	ledgerOpen(limit: number): number;
	ledgerClose(ledger: number): EngineResult<void>;
	/** Record the document handle's last execution; `optionsJson` is `{"gesture"?}`. Returns the step id. */
	ledgerRecord(ledger: number, doc: number, optionsJson: string): EngineResult<string>;
	/** Record a change the host applied itself: `{command, inverse, before, after, gesture?}`. Returns the step id. */
	ledgerRecordApplied(ledger: number, json: string): EngineResult<string>;
	/** Undo on the document handle: `null`, or `{"delta"}`. A refused inverse drops the step (`UndoRefused`). */
	ledgerUndo(ledger: number, doc: number): EngineResult<string>;
	/** Redo on the document handle: `null`, or `{"delta"}`. */
	ledgerRedo(ledger: number, doc: number): EngineResult<string>;
	/** `{"undo": [ids], "redo": [ids]}`, oldest first. */
	ledgerState(ledger: number): EngineResult<string>;
	/** Open a queue of local commands the server has not accepted; returns its handle. */
	pendingOpen(): number;
	pendingClose(queue: number): EngineResult<void>;
	/** `{id, command, inverse}`, in the order the user made them. */
	pendingEnqueue(queue: number, json: string): EngineResult<void>;
	/** The server accepted `id`; true when it was pending. */
	pendingAck(queue: number, id: string): EngineResult<boolean>;
	/** `{delivered: [commands]}` → `{delta, dropped: [{id, type, kind, message}]}`. */
	pendingRebase(queue: number, ledger: number, doc: number, json: string): EngineResult<string>;
	/** A server reply (`p1-command-log` D3): `{delivered: [commands], accepted?: [ids], rejected?: [ids]}`
	 *  → `{delta, dropped}`. Undo pending, apply delivered, re-apply pending except rejected, then
	 *  remove accepted and rejected. `RebaseAccepted` when an accepted command no longer applies. */
	pendingResolve(queue: number, ledger: number, doc: number, json: string): EngineResult<string>;
	/** `[{id, type}]` in queue order. */
	pendingState(queue: number): EngineResult<string>;
	/** `{selection, action}` → the next selection. */
	selectionApply(json: string): EngineResult<string>;
	/** Admit a project envelope (`p1-envelope-inspector`): its serialized form, or an
	 *  error of kind `EnvelopeRefused` whose message is `{kind, reason, path, message}` JSON. */
	envelopeAdmit(json: string): EngineResult<string>;
	/** An inspector rule (`p1-envelope-inspector`): `{op, …}` → the op's result as JSON.
	 *  `doc` names the document an op reads; 0 for the stateless ops. */
	inspectorApply(doc: number, json: string): EngineResult<string>;
	/* Canvas editing (`p2-preview-editing` D2): a canvas handle over a document
	 * handle, one call per input event. Typed in `canvas-engine.ts`. */
	/** Open a canvas over document handle `doc`; returns its handle. */
	canvasOpen(doc: number): EngineResult<number>;
	canvasClose(canvas: number): EngineResult<void>;
	canvasOpenCount(): number;
	/** Where the canvas sits on the screen: `{area, aspect, fit?, zoom?, pan?, density?, handleSize?, handlesOutside?}`. */
	canvasView(canvas: number, json: string): EngineResult<void>;
	/** One input event → `{overlay, select, preview, commit, handled}`. */
	canvasInput(canvas: number, json: string): EngineResult<string>;
	/** `{time, selection | targets, visual?, mask?}` → the overlay to draw. */
	canvasOverlay(canvas: number, json: string): EngineResult<string>;
	/** `{target}` → `{clipId, layout, start, duration, kind, visualId}` or `null`. */
	canvasLayout(doc: number, json: string): EngineResult<string>;
	/** `{target, patch, unset?, time?}` → the command the change makes. */
	canvasEdit(doc: number, json: string): EngineResult<string>;
	/** `{layout, axis, value}` → the patch an aspect-locked size field writes. */
	canvasSizePatch(json: string): EngineResult<string>;
	/** Open temporary source readiness state, independent of authored documents. */
	decoderOpen(): number;
	decoderRequest(owner: number, request: number, kind: 1 | 2, slots: 1 | 2): EngineResult<void>;
	decoderShouldYield(owner: number, lease: number): boolean;
	decoderRelease(owner: number, lease: number): void;
	decoderClose(owner: number): void;
	decoderGrants(): EngineResult<string>;
	mediaOpen(): number;
	mediaClose(handle: number): EngineResult<void>;
	/** `{type: update|complete|retry|snapshot, ...}` → `{accepted, snapshot, requests}`. */
	mediaDispatch(handle: number, json: string): EngineResult<string>;
}

interface Exports {
	memory: WebAssembly.Memory;
	engine_alloc(len: number): number;
	engine_output_ptr(): number;
	engine_output_len(): number;
	engine_open(ptr: number, len: number): number;
	engine_execute(handle: number, ptr: number, len: number): number;
	engine_execute_delta(handle: number, ptr: number, len: number): number;
	engine_read(handle: number): number;
	engine_close(handle: number): number;
	engine_open_count(): number;
	engine_execute_once(
		scopePtr: number,
		scopeLen: number,
		commandPtr: number,
		commandLen: number,
	): number;
	engine_seconds_to_ticks(seconds: number): number;
	policy_open(statePtr: number, stateLen: number, beginPtr: number, beginLen: number): number;
	policy_update(handle: number, ptr: number, len: number): number;
	policy_commit(handle: number): number;
	policy_rollback(handle: number): number;
	policy_close(handle: number): number;
	policy_open_count(): number;
	time_format_timecode(
		frames: number,
		numerator: number,
		denominator: number,
		ticksPerFrame: number,
		dropFrame: number,
	): number;
	policy_snap(ptr: number, len: number): number;
	ledger_open(limit: number): number;
	ledger_close(ledger: number): number;
	ledger_record(ledger: number, doc: number, ptr: number, len: number): number;
	ledger_record_applied(ledger: number, ptr: number, len: number): number;
	ledger_undo(ledger: number, doc: number): number;
	ledger_redo(ledger: number, doc: number): number;
	ledger_state(ledger: number): number;
	pending_open(): number;
	pending_close(queue: number): number;
	pending_enqueue(queue: number, ptr: number, len: number): number;
	pending_ack(queue: number, ptr: number, len: number): number;
	pending_rebase(queue: number, ledger: number, doc: number, ptr: number, len: number): number;
	pending_resolve(queue: number, ledger: number, doc: number, ptr: number, len: number): number;
	pending_state(queue: number): number;
	selection_apply(ptr: number, len: number): number;
	envelope_admit(ptr: number, len: number): number;
	inspector_apply(doc: number, ptr: number, len: number): number;
	canvas_open(doc: number): number;
	canvas_close(canvas: number): number;
	canvas_open_count(): number;
	canvas_view(canvas: number, ptr: number, len: number): number;
	canvas_input(canvas: number, ptr: number, len: number): number;
	canvas_overlay(canvas: number, ptr: number, len: number): number;
	canvas_layout(doc: number, ptr: number, len: number): number;
	canvas_edit(doc: number, ptr: number, len: number): number;
	canvas_size_patch(ptr: number, len: number): number;
	decoder_open(): number;
	decoder_request(owner: number, request: number, kind: number, slots: number): number;
	decoder_should_yield(owner: number, lease: number): number;
	decoder_release(owner: number, lease: number): void;
	decoder_close(owner: number): void;
	decoder_grants(): number;
	media_open(): number;
	media_close(handle: number): number;
	media_dispatch(handle: number, ptr: number, len: number): number;
}

/* Every export, checked to exist with the right kind, so a stale or foreign
 * module fails here by name instead of at the first call. */
function exportsOf(instance: WebAssembly.Instance): Exports {
	const call = (name: string): ((...args: number[]) => number) => {
		const value = instance.exports[name];
		if (typeof value !== "function")
			throw new Error(`editor engine module is missing export ${name}`);
		return (...args: number[]): number => Number(value(...args));
	};
	const memory = instance.exports.memory;
	if (!(memory instanceof WebAssembly.Memory))
		throw new Error("editor engine module is missing export memory");
	return {
		memory,
		engine_alloc: call("engine_alloc"),
		engine_output_ptr: call("engine_output_ptr"),
		engine_output_len: call("engine_output_len"),
		engine_open: call("engine_open"),
		engine_execute: call("engine_execute"),
		engine_execute_delta: call("engine_execute_delta"),
		engine_read: call("engine_read"),
		engine_close: call("engine_close"),
		engine_open_count: call("engine_open_count"),
		engine_execute_once: call("engine_execute_once"),
		engine_seconds_to_ticks: call("engine_seconds_to_ticks"),
		policy_open: call("policy_open"),
		policy_update: call("policy_update"),
		policy_commit: call("policy_commit"),
		policy_rollback: call("policy_rollback"),
		policy_close: call("policy_close"),
		policy_open_count: call("policy_open_count"),
		time_format_timecode: call("time_format_timecode"),
		policy_snap: call("policy_snap"),
		ledger_open: call("ledger_open"),
		ledger_close: call("ledger_close"),
		ledger_record: call("ledger_record"),
		ledger_record_applied: call("ledger_record_applied"),
		ledger_undo: call("ledger_undo"),
		ledger_redo: call("ledger_redo"),
		ledger_state: call("ledger_state"),
		pending_open: call("pending_open"),
		pending_close: call("pending_close"),
		pending_enqueue: call("pending_enqueue"),
		pending_ack: call("pending_ack"),
		pending_rebase: call("pending_rebase"),
		pending_resolve: call("pending_resolve"),
		pending_state: call("pending_state"),
		selection_apply: call("selection_apply"),
		envelope_admit: call("envelope_admit"),
		inspector_apply: call("inspector_apply"),
		canvas_open: call("canvas_open"),
		canvas_close: call("canvas_close"),
		canvas_open_count: call("canvas_open_count"),
		canvas_view: call("canvas_view"),
		canvas_input: call("canvas_input"),
		canvas_overlay: call("canvas_overlay"),
		canvas_layout: call("canvas_layout"),
		canvas_edit: call("canvas_edit"),
		canvas_size_patch: call("canvas_size_patch"),
		decoder_open: call("decoder_open"),
		decoder_request: call("decoder_request"),
		decoder_should_yield: call("decoder_should_yield"),
		decoder_release: call("decoder_release"),
		decoder_close: call("decoder_close"),
		decoder_grants: call("decoder_grants"),
		media_open: call("media_open"),
		media_close: call("media_close"),
		media_dispatch: call("media_dispatch"),
	};
}

export async function instantiateEngine(
	bytes: ConstructorParameters<typeof WebAssembly.Module>[0],
): Promise<Engine> {
	/* The module imports nothing, so it is given nothing. */
	const module = await WebAssembly.compile(bytes);
	return engineOf(exportsOf(await WebAssembly.instantiate(module, {})));
}

/** For a server runtime, where compiling a module synchronously is allowed (a
 *  browser main thread refuses modules over 4 KB): the API loads the engine on
 *  first use inside a synchronous command path. */
export function instantiateEngineSync(
	bytes: ConstructorParameters<typeof WebAssembly.Module>[0],
): Engine {
	return engineOf(exportsOf(new WebAssembly.Instance(new WebAssembly.Module(bytes), {})));
}

function engineOf(wasm: Exports): Engine {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	/* Copy text into a buffer the engine owns; the callee frees it. Views over
	 * `memory.buffer` are taken after allocating, because allocation can grow
	 * (and so detach) the buffer. */
	const write = (text: string): [number, number] => {
		const bytes = encoder.encode(text);
		const ptr = wasm.engine_alloc(bytes.length);
		new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
		return [ptr, bytes.length];
	};
	const output = (): string =>
		decoder.decode(
			new Uint8Array(wasm.memory.buffer, wasm.engine_output_ptr(), wasm.engine_output_len()),
		);
	const parseError = (text: string): EngineError => {
		try {
			const value: unknown = JSON.parse(text);
			if (value !== null && typeof value === "object" && "kind" in value && "message" in value)
				return { kind: String(value.kind), message: String(value.message) };
		} catch {
			/* Not JSON: reported as-is below. */
		}
		return { kind: "Unknown", message: text };
	};
	const result = (status: number): EngineResult<string> =>
		status === 0 ? { ok: true, value: output() } : { ok: false, error: parseError(output()) };
	const done = (status: EngineResult<string>): EngineResult<void> =>
		status.ok ? { ok: true, value: undefined } : status;

	return {
		open(scopeJson) {
			const handle = wasm.engine_open(...write(scopeJson));
			return handle === 0
				? { ok: false, error: parseError(output()) }
				: { ok: true, value: handle };
		},
		execute: (handle, commandJson) => result(wasm.engine_execute(handle, ...write(commandJson))),
		executeDelta: (handle, commandJson) =>
			result(wasm.engine_execute_delta(handle, ...write(commandJson))),
		read: (handle) => result(wasm.engine_read(handle)),
		close(handle) {
			const closed = result(wasm.engine_close(handle));
			return closed.ok ? { ok: true, value: undefined } : closed;
		},
		executeOnce(scopeJson, commandJson) {
			const [scopePtr, scopeLen] = write(scopeJson);
			const [commandPtr, commandLen] = write(commandJson);
			return result(wasm.engine_execute_once(scopePtr, scopeLen, commandPtr, commandLen));
		},
		secondsToTicks: (seconds) => wasm.engine_seconds_to_ticks(seconds),
		openCount: () => wasm.engine_open_count(),
		gestureOpen(stateJson, beginJson) {
			const [statePtr, stateLen] = write(stateJson);
			const [beginPtr, beginLen] = write(beginJson);
			const handle = wasm.policy_open(statePtr, stateLen, beginPtr, beginLen);
			return handle === 0
				? { ok: false, error: parseError(output()) }
				: { ok: true, value: handle };
		},
		gestureUpdate: (handle, updateJson) => result(wasm.policy_update(handle, ...write(updateJson))),
		gestureCommit: (handle) => result(wasm.policy_commit(handle)),
		gestureRollback: (handle) => result(wasm.policy_rollback(handle)),
		gestureClose(handle) {
			const closed = result(wasm.policy_close(handle));
			return closed.ok ? { ok: true, value: undefined } : closed;
		},
		gestureOpenCount: () => wasm.policy_open_count(),
		formatTimecode: (frames, rate, ticksPerFrame, dropFrame) =>
			result(
				wasm.time_format_timecode(
					frames,
					rate.numerator,
					rate.denominator,
					ticksPerFrame,
					dropFrame ? 1 : 0,
				),
			),
		snap: (requestJson) => result(wasm.policy_snap(...write(requestJson))),
		ledgerOpen: (limit) => wasm.ledger_open(limit),
		ledgerClose: (ledger) => done(result(wasm.ledger_close(ledger))),
		ledgerRecord: (ledger, doc, optionsJson) =>
			result(wasm.ledger_record(ledger, doc, ...write(optionsJson))),
		ledgerRecordApplied: (ledger, json) =>
			result(wasm.ledger_record_applied(ledger, ...write(json))),
		ledgerUndo: (ledger, doc) => result(wasm.ledger_undo(ledger, doc)),
		ledgerRedo: (ledger, doc) => result(wasm.ledger_redo(ledger, doc)),
		ledgerState: (ledger) => result(wasm.ledger_state(ledger)),
		pendingOpen: () => wasm.pending_open(),
		pendingClose: (queue) => done(result(wasm.pending_close(queue))),
		pendingEnqueue: (queue, json) => done(result(wasm.pending_enqueue(queue, ...write(json)))),
		pendingAck(queue, id) {
			const acked = result(wasm.pending_ack(queue, ...write(id)));
			return acked.ok ? { ok: true, value: acked.value === "true" } : acked;
		},
		pendingRebase: (queue, ledger, doc, json) =>
			result(wasm.pending_rebase(queue, ledger, doc, ...write(json))),
		pendingResolve: (queue, ledger, doc, json) =>
			result(wasm.pending_resolve(queue, ledger, doc, ...write(json))),
		pendingState: (queue) => result(wasm.pending_state(queue)),
		selectionApply: (json) => result(wasm.selection_apply(...write(json))),
		inspectorApply: (doc, json) => result(wasm.inspector_apply(doc, ...write(json))),
		envelopeAdmit(json) {
			const status = wasm.envelope_admit(...write(json));
			// The refusal carries reason and path beyond `{kind, message}`, so its whole text is the message.
			return status === 0
				? { ok: true, value: output() }
				: { ok: false, error: { kind: parseError(output()).kind, message: output() } };
		},
		canvasOpen(doc) {
			const handle = wasm.canvas_open(doc);
			return handle === 0
				? { ok: false, error: parseError(output()) }
				: { ok: true, value: handle };
		},
		canvasClose: (canvas) => done(result(wasm.canvas_close(canvas))),
		canvasOpenCount: () => wasm.canvas_open_count(),
		canvasView: (canvas, json) => done(result(wasm.canvas_view(canvas, ...write(json)))),
		canvasInput: (canvas, json) => result(wasm.canvas_input(canvas, ...write(json))),
		canvasOverlay: (canvas, json) => result(wasm.canvas_overlay(canvas, ...write(json))),
		canvasLayout: (doc, json) => result(wasm.canvas_layout(doc, ...write(json))),
		canvasEdit: (doc, json) => result(wasm.canvas_edit(doc, ...write(json))),
		canvasSizePatch: (json) => result(wasm.canvas_size_patch(...write(json))),
		decoderOpen: () => wasm.decoder_open(),
		decoderRequest: (owner, request, kind, slots) =>
			done(result(wasm.decoder_request(owner, request, kind, slots))),
		decoderShouldYield: (owner, lease) => wasm.decoder_should_yield(owner, lease) !== 0,
		decoderRelease: (owner, lease) => wasm.decoder_release(owner, lease),
		decoderClose: (owner) => wasm.decoder_close(owner),
		decoderGrants: () => result(wasm.decoder_grants()),
		mediaOpen: () => wasm.media_open(),
		mediaClose: (handle) => done(result(wasm.media_close(handle))),
		mediaDispatch: (handle, json) => result(wasm.media_dispatch(handle, ...write(json))),
	};
}
