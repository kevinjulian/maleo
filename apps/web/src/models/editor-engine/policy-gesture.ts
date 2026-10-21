/* A timeline gesture through the Rust edit policies (`migrate-editor-to-shared-rust-core`,
 * task 4.5).
 *
 * The host keeps the gesture loop — engagement, samples, cancel — and asks the
 * engine for each projection. The base state crosses once, when the gesture
 * opens, and is held behind a gesture handle; every pointer sample sends only
 * the update and receives only the projection (budgets: task 4.2). The cross
 * axis crosses as data: the adapter the host already has is read once at open. */
import type { Engine } from "@maleo/shared/editor";
import type { CrossAxisAdapter } from "@models/timeline-view/cross-axis.ts";
import type { Operation } from "@models/timeline-view/operations.ts";
import type { SnapCandidate } from "@models/timeline-view/engagement.ts";
import type { TimelineItem, TimelineState } from "@models/timeline-view/types.ts";

/* The engine's wire shapes for a gesture (`crates/editor-core/src/policy/decode.rs`). */

export type TrimKind = "trim" | "ripple" | "roll" | "slip" | "slide";

export interface MoveIntent {
	readonly id: string;
	/** Snap candidates the editor supplies for this edit. */
	readonly candidates?: readonly SnapCandidate[];
}

export interface TrimIntent {
	readonly id: string;
	readonly edge: "start" | "end";
	readonly kind: TrimKind;
	/** The item on the other side of the boundary, for a roll. */
	readonly neighbourId?: string;
	readonly candidates?: readonly SnapCandidate[];
}

interface SnapSettings {
	readonly thresholdPx: number;
	/** Pixels per tick. */
	readonly scale: number;
	readonly bypass?: boolean;
}

/** One sample of a drag, in the units the surface has. */
export interface MoveUpdate {
	readonly deltaTicks: number;
	/** Where the pointer is on the cross axis. Absent on a single-row timeline. */
	readonly yPx?: number;
	readonly snap?: SnapSettings;
	/** The deliberate-overlap modifier is held. */
	readonly deliberate?: boolean;
}

export interface TrimUpdate {
	readonly deltaTicks: number;
	readonly snap?: SnapSettings;
}

/** What the gesture does. A move's cross axis is passed to `openPolicyGesture`. */
export type PolicyIntent = ({ policy: "move" } & MoveIntent) | ({ policy: "trim" } & TrimIntent);

/** One item where the edit currently puts it. */
export interface ProjectedItem {
	id: string;
	rowId?: string;
	startTicks: number;
	durationTicks: number;
	sourceInTicks?: number;
}

/** The engine's projection: only the items the edit changes. */
export interface PolicyProjection {
	items: ProjectedItem[];
	valid: boolean;
	reason?: string;
	destinationRow?: string;
	rowRefused?: boolean;
	snappedTo?: SnapCandidate;
	clamped?: boolean;
}

export type PolicyTerminal = { ok: true; operation?: Operation } | { ok: false; rejection: string };

export interface PolicyGesture {
	update(sample: MoveUpdate | TrimUpdate): PolicyProjection;
	/** Commit once; the handle is released either way. */
	commit(): PolicyTerminal;
	rollback(): void;
}

/** The cross axis as data: every row's height, the kinds it takes, and where a
 *  refused kind is rerouted. Read once, at open, from the adapter the kernel
 *  itself consults; acceptance is asked with a real item of each kind. */
function axisData(axis: CrossAxisAdapter, items: Iterable<TimelineItem>): unknown {
	const byKind = new Map<string, TimelineItem>();
	for (const item of items) if (!byKind.has(item.kind)) byKind.set(item.kind, item);
	const rows = axis.order();
	const reroutes: Record<string, Record<string, string | null>> = {};
	for (const [kind, item] of byKind) {
		for (const row of rows) {
			if (axis.accepts(row, item)) continue;
			reroutes[kind] = { ...reroutes[kind], [row]: axis.reroute(item, row) ?? null };
		}
	}
	return {
		rows: rows.map((id) => ({
			id,
			heightPx: axis.heightOf(id),
			accepts: [...byKind].filter(([, item]) => axis.accepts(id, item)).map(([kind]) => kind),
		})),
		refusal: axis.refusal,
		reroutes,
	};
}

function stateData(state: TimelineState, axis: CrossAxisAdapter | undefined): string {
	const items = state.order.flatMap((id) => {
		const item = state.items.get(id);
		if (!item) return [];
		return [
			JSON.parse(
				JSON.stringify({
					id: item.id,
					rowId: item.rowId,
					kind: item.kind,
					startTicks: item.start.ticks,
					durationTicks: item.duration.ticks,
					source: item.source && {
						inPointTicks: item.source.inPoint.ticks,
						availableStartTicks: item.source.availableStart.ticks,
						availableEndTicks: item.source.availableEnd.ticks,
					},
					groupId: item.groupId,
					linkedTo: item.linkedTo,
				}),
			),
		];
	});
	return JSON.stringify({
		rows: state.rows,
		items,
		...(axis ? { crossAxis: axisData(axis, state.items.values()) } : {}),
	});
}

/** Open a gesture over `state`. `id` names the transaction in its rejections;
 *  `axis` is the move's cross axis, when it has one. */
export function openPolicyGesture(
	engine: Engine,
	id: string,
	state: TimelineState,
	intent: PolicyIntent,
	axis: CrossAxisAdapter | undefined,
): PolicyGesture {
	const withAxis = intent.policy === "move" ? { ...intent, crossAxis: axis !== undefined } : intent;
	const opened = engine.gestureOpen(
		stateData(state, intent.policy === "move" ? axis : undefined),
		JSON.stringify({ id, intent: withAxis }),
	);
	if (!opened.ok) throw new Error(`the edit policy refused the gesture: ${opened.error.message}`);
	const handle = opened.value;
	let closed = false;
	const release = (): void => {
		if (closed) return;
		closed = true;
		engine.gestureClose(handle);
	};
	return {
		update(sample) {
			const projected = engine.gestureUpdate(handle, JSON.stringify(sample));
			// SAFETY: the projection as `Projection` serializes in `crates/editor-core/src/policy/model.rs`.
			return projected.ok
				? (JSON.parse(projected.value) as PolicyProjection)
				: { items: [], valid: false, reason: projected.error.message };
		},
		commit() {
			const ended = engine.gestureCommit(handle);
			release();
			/* SAFETY: `{ok, operation?}` or `{ok: false, rejection}` from `Transaction::commit`. The
			 * move and trim policies produce only move, reshape and composite operations, whose JSON
			 * is the kernel's `Operation` exactly (pinned by `scripts/editor-policy.test.ts`). */
			return ended.ok
				? (JSON.parse(ended.value) as PolicyTerminal)
				: { ok: false, rejection: ended.error.message };
		},
		rollback() {
			if (!closed) engine.gestureRollback(handle);
			release();
		},
	};
}

/** Snap outside a gesture (a media drop): the nearest candidate within the
 *  threshold, a moving item's own candidates excluded, unless bypassed. */
export function snapTicks(
	engine: Engine,
	ticks: number,
	candidates: readonly SnapCandidate[],
	options: SnapSettings & { readonly moving?: readonly string[] },
): { ticks: number; candidate?: SnapCandidate } {
	const snapped = engine.snap(JSON.stringify({ ticks, candidates, ...options }));
	if (!snapped.ok) throw new Error(`the engine refused a snap: ${snapped.error.message}`);
	// SAFETY: `{ticks, candidate}` as `snap_json` in `crates/editor-wasm/src/lib.rs` writes it; `candidate` is null when none was taken.
	const out = JSON.parse(snapped.value) as { ticks: number; candidate: SnapCandidate | null };
	return out.candidate ? { ticks: out.ticks, candidate: out.candidate } : { ticks: out.ticks };
}
