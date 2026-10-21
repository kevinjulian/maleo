/* Operations: what a committed timeline edit is, as data — the shape the Rust
 * edit policies return from a gesture's commit (`crates/editor-core/src/policy/
 * model.rs`), which `contentEditsOf` (`models/timeline/content-edits.ts`) turns into the editor's writes. Applying
 * and inverting them is the engine's; only the shapes live here. */
import type { ItemId, MarkerId, RowId, TimelineItem } from "./types.ts";

/** Where an item sits: when, and on which row. */
export interface Placement {
	readonly startTicks: number;
	readonly rowId?: RowId;
}

/** What an item covers: on the timeline, and within its media. */
export interface Span {
	readonly startTicks: number;
	readonly durationTicks: number;
	/** Absent for an item with no media behind it. */
	readonly sourceInTicks?: number;
}

/** One item's move, before and after. */
export interface MoveEntry {
	readonly id: ItemId;
	readonly from: Placement;
	readonly to: Placement;
}

/** One item's reshaping, before and after. */
export interface TrimEntry {
	readonly id: ItemId;
	readonly from: Span;
	readonly to: Span;
}

/** One marker's move, before and after. */
export interface MarkerEntry {
	readonly id: MarkerId;
	readonly fromTicks: number;
	readonly toTicks: number;
}

/** Items changed position or row. */
export interface MoveOperation {
	readonly type: "move";
	readonly entries: readonly MoveEntry[];
}

/**
 * Items changed shape.
 *
 * One variant covers trim, ripple, roll, slip, and slide, because every one of
 * them is "these items ended up with these spans". The difference between them
 * is which items the *policy* decided to include and how it computed their
 * spans — a distinction that belongs to the edit, not to the record of it. A
 * separate operation per named edit would make undo depend on remembering which
 * name produced a change it can already describe exactly.
 */
export interface ReshapeOperation {
	readonly type: "reshape";
	readonly entries: readonly TrimEntry[];
}

/** Items were added. Inverting removes exactly these. */
export interface InsertOperation {
	readonly type: "insert";
	readonly items: readonly TimelineItem[];
}

/** Items were taken away. Carries them whole, so the inverse can put them back. */
export interface RemoveOperation {
	readonly type: "remove";
	readonly items: readonly TimelineItem[];
}

/** Markers moved. */
export interface MarkerOperation {
	readonly type: "marker";
	readonly entries: readonly MarkerEntry[];
}

/**
 * Several operations that are one edit.
 *
 * A group edit is one operation and one undo step, which is a requirement
 * rather than a convenience: a group that undoes in five steps is a group only
 * until someone presses undo.
 */
export interface CompositeOperation {
	readonly type: "composite";
	readonly operations: readonly Operation[];
}

/** Everything a commit can produce. */
export type Operation =
	| MoveOperation
	| ReshapeOperation
	| InsertOperation
	| RemoveOperation
	| MarkerOperation
	| CompositeOperation;
