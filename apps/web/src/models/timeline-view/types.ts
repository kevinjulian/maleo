/* The timeline model.
 *
 * Everything a timeline is, described without reference to any host. There is
 * no element, no pixel-of-the-page, and no consumer schema in this file: the
 * library reads a consumer's document through an adapter and never owns one, so
 * what follows is the library's own working shape and not anybody's storage
 * format.
 *
 * Two things are deliberately NOT here, and both are load-bearing absences:
 *
 *   - **Row height.** The cross-axis adapter answers "what is row N's height
 *     and offset". A height in the model is a height that has to agree with one
 *     in a stylesheet, and nothing checks that two such numbers agree.
 *   - **Item shape beyond time.** An item's kind is an opaque string the
 *     consumer owns. The library resolves time and interaction; what an item
 *     *is* belongs to the document.
 */
import type { ProjectTime, SourceTime } from "./tick.ts";
import type { Timebase } from "./timebase.ts";
import type { GestureId, GestureOutcome, GestureState } from "./gesture.ts";

/** Consumer-owned identity for an item. Opaque to the library. */
export type ItemId = string;

/** Consumer-owned identity for a row. Opaque to the library. */
export type RowId = string;

/** Consumer-owned identity for a marker. Opaque to the library. */
export type MarkerId = string;

/** Consumer-owned identity for a nested track. Opaque to the library. */
export type TrackId = string;

/** How items share a row. */
export type PlacementPolicy = "magnetic" | "free";

/**
 * What a row does when an edit would put two items on top of each other.
 *
 * Declared per row rather than per edit, so the answer does not depend on which
 * gesture asked. `permit` is how a consumer opts into deliberate overlap.
 */
export type OverlapStrategy = "reject" | "insert" | "overwrite" | "permit";

/** The media behind an item, and how much of it there is. */
export interface ItemSource {
	/** The media's own native rate, which need not be the project's. */
	readonly timebase: Timebase;
	/** Where this item starts within the media. */
	readonly inPoint: SourceTime;
	/** The first frame of media that exists. */
	readonly availableStart: SourceTime;
	/** One past the last frame of media that exists. */
	readonly availableEnd: SourceTime;
}

/** A point of interest, on the timeline or inside a nested track. */
export interface Marker {
	readonly id: MarkerId;
	readonly at: ProjectTime;
	readonly label?: string;
}

/**
 * A track nested inside an item: keyframes for a property, a colour curve.
 *
 * Nested rather than a row of its own, because its positions are meaningful
 * only relative to the item that carries it, and a consumer that flattened them
 * into rows would have to re-derive that relationship on every edit.
 */
export interface NestedTrack {
	readonly id: TrackId;
	readonly label: string;
	readonly markers: readonly Marker[];
}

/** One thing on the timeline. */
export interface TimelineItem {
	readonly id: ItemId;
	/** Absent on a single-row timeline, where no operation carries a row. */
	readonly rowId?: RowId;
	readonly start: ProjectTime;
	readonly duration: ProjectTime;
	/** The consumer's own kind. The library never interprets it. */
	readonly kind: string;
	readonly label?: string;
	readonly source?: ItemSource;
	/** A locked item declines every editing capability and stays selectable. */
	readonly locked?: boolean;
	/** Items sharing a group move, trim, and undo as one. */
	readonly groupId?: string;
	/** Items that must take the same edit at the same edge — audio to its video. */
	readonly linkedTo?: readonly ItemId[];
	readonly tracks?: readonly NestedTrack[];
}

/** A row's own policy. Its height and offset come from the consumer's adapter. */
export interface Row {
	readonly id: RowId;
	readonly placement: PlacementPolicy;
	readonly overlap: OverlapStrategy;
	/** A locked row's items decline every editing capability. */
	readonly locked?: boolean;
}

/**
 * What an item currently allows.
 *
 * Capability is data, and a host layer renders nothing for a declined one — it
 * does not render it and hide it. An affordance hidden with `display: none`
 * keeps its hit box and takes the press meant for the item beneath, which was
 * found twice in the previous implementation.
 */
export interface ItemCapabilities {
	readonly select: boolean;
	readonly move: boolean;
	readonly trimStart: boolean;
	readonly trimEnd: boolean;
	readonly remove: boolean;
	/** True when every editing capability is declined. */
	readonly readOnly: boolean;
}

/** What is focused. Focus is one thing, tracked apart from selection. */
export type FocusTarget =
	| { readonly kind: "item"; readonly id: ItemId }
	| { readonly kind: "row"; readonly id: RowId }
	| { readonly kind: "marker"; readonly id: MarkerId }
	| { readonly kind: "ruler" };

/**
 * What is currently shown, and at what magnification.
 *
 * The stored fields are `start`, `scale`, and `widthPx`; `end` is derived from
 * them. Keeping the derived field out of the stored state is what makes "the
 * viewport has one writer" checkable — there is no second field that could
 * disagree with the first three.
 */
export interface ViewportInput {
	readonly start: ProjectTime;
	/** Device pixels per project tick. Positive. */
	readonly scale: number;
	/** How wide the viewport is, in device pixels. */
	readonly widthPx: number;
	/** Run-off before time zero, in device pixels: leading padding inside the
	 *  scroller, so that time zero can sit away from its left edge. The view
	 *  may start up to this far before zero, and a scroll offset is this much
	 *  larger than the start it shows. Absent means none. */
	readonly leadPx?: number;
}

/** A viewport as published, with `end` resolved. */
export interface Viewport extends ViewportInput {
	readonly end: ProjectTime;
}

/** The whole of a timeline's kernel state. */
export interface TimelineState {
	readonly timebase: Timebase;
	readonly duration: ProjectTime;
	readonly rows: readonly Row[];
	/** Keyed, so a lookup by identity is O(1) rather than a scan per item drawn. */
	readonly items: ReadonlyMap<ItemId, TimelineItem>;
	/** Painting and traversal order. Membership always matches `items`. */
	readonly order: readonly ItemId[];
	readonly markers: readonly Marker[];
	readonly selection: ReadonlySet<ItemId>;
	readonly focus?: FocusTarget;
	readonly viewport: Viewport;
	/**
	 * Gestures in flight, keyed by gesture identity.
	 *
	 * Here rather than in a component belonging to the item, so an item is free
	 * to re-render, change parent, or unmount while a gesture concerning it is
	 * running. A map because a coarse pointer produces more than one at a time.
	 */
	readonly gestures: ReadonlyMap<GestureId, GestureState>;
	/** The terminal phase of the most recently ended gesture, and its reason. */
	readonly lastGesture?: GestureOutcome;
}
