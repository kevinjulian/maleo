/* Painted pixels are not a representation anything can act on but an eye.
 *
 * Every item and affordance a person can use has a real focusable element with a
 * role and an accessible name, whether or not its pixels are on the canvas. This
 * module says what those elements must be; the overlay decides which of them
 * exist, and the consumer's factory builds them.
 *
 * The names are computed here rather than left to each consumer because they are
 * part of the contract: a timeline whose items announce as "button" is
 * technically accessible and useless.
 */
import type { ItemCapabilities, TimelineItem } from "@models/timeline-view/types.ts";

/** What one focusable element in the overlay is. */
export interface AccessibleNode {
	readonly role: string;
	/** The accessible name. Never empty. */
	readonly name: string;
	/** 0 for the roving-focus member, -1 for the rest. */
	readonly tabIndex: number;
	readonly ariaSelected?: boolean;
	readonly ariaDisabled?: boolean;
	/** Marks the element for hit-testing and for role-based test selectors. */
	readonly slot: string;
}

export interface ItemAccessibilityOptions {
	/** Human time for the item's start, e.g. its timecode. */
	readonly at?: string;
	readonly duration?: string;
	/** Whether this item currently holds the roving tab stop. */
	readonly focused?: boolean;
	readonly selected?: boolean;
}

/** How an item's own element presents. */
export function itemAccessibility(
	item: TimelineItem,
	capabilities: ItemCapabilities,
	options: ItemAccessibilityOptions = {},
): AccessibleNode {
	/* `option` inside a `listbox`, not `button`: the timeline is a selection of
	 * things, and selection state has no expression on a button. */
	const label = item.label ?? `${item.kind} ${item.id}`;
	const at = options.at === undefined ? "" : `, ${options.at}`;
	const duration = options.duration === undefined ? "" : `, ${options.duration}`;
	const locked = capabilities.readOnly ? ", locked" : "";
	return {
		role: "option",
		name: `${label}${at}${duration}${locked}`,
		tabIndex: options.focused === true ? 0 : -1,
		ariaSelected: options.selected === true,
		ariaDisabled: capabilities.readOnly ? true : undefined,
		slot: "item",
	};
}

/** The trim handles that exist. A declined capability produces no entry at all. */
export function handleAccessibility(
	item: TimelineItem,
	capabilities: ItemCapabilities,
): AccessibleNode[] {
	const label = item.label ?? item.id;
	const nodes: AccessibleNode[] = [];
	/* Only for granted capabilities. An affordance rendered and hidden keeps its
	 * hit area and takes the press meant for the body — found twice in the
	 * previous implementation, and the reason capability is data. */
	if (capabilities.trimStart)
		nodes.push({
			role: "slider",
			name: `Trim start of ${label}`,
			tabIndex: -1,
			slot: "trim-start",
		});
	if (capabilities.trimEnd)
		nodes.push({ role: "slider", name: `Trim end of ${label}`, tabIndex: -1, slot: "trim-end" });
	return nodes;
}

/* ---- The live region ------------------------------------------------------ */

/** The element announcements are written into. */
export interface LiveRegionTarget {
	textContent: string | null;
}

/** Announces committed results, and refuses to exist without its region. */
export interface Announcer {
	announce(message: string): void;
	/** What was last said. For tests, and for a consumer's own status line. */
	lastMessage(): string | undefined;
}

/**
 * @throws when no region is supplied.
 *
 * Deliberately: "the region is present before its text changes" cannot be
 * enforced by a component that mounts the region together with its first
 * message, and most screen readers do not announce such a region at all. Making
 * the region a construction requirement turns that rule into something that
 * cannot be got wrong later.
 */
export function createAnnouncer(region: LiveRegionTarget | undefined): Announcer {
	if (!region)
		throw new Error(
			"@maleo/vui: a live region must exist in the document before the first announcement",
		);
	let last: string | undefined;
	return {
		announce(message) {
			last = message;
			region.textContent = message;
		},
		lastMessage: () => last,
	};
}

/** The attributes a live region needs. Polite, because an edit is not an alert. */
export const LIVE_REGION_ATTRIBUTES = {
	role: "status",
	"aria-live": "polite",
	"aria-atomic": "true",
} as const;
