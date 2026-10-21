/* What a committed timeline operation asks the editor to write
 * (`migrate-editor-to-shared-rust-core`, task 4.10).
 *
 * The Rust edit policies commit an operation in ticks; the editor's writers
 * take seconds, lanes and source in-points, one edit per clip. Pure, so it is a
 * model the content timeline's gesture loop and its tests share. */
import { clipSourceRange, sliceSourceInterval, type Clip } from "@maleo/shared";
import type { Operation } from "@models/timeline-view/operations.ts";
import type { ItemId } from "@models/timeline-view/types.ts";
import { CONTENT_TIMEBASE, laneTrackOf } from "./content-document-adapter.ts";

const ticksToSeconds = (ticks: number): number => ticks / (30 * CONTENT_TIMEBASE.ticksPerFrame);

/** One clip's committed change. */
export interface ContentEdit {
	readonly clipId: string;
	readonly startSec?: number;
	readonly durSec?: number;
	readonly track?: number;
	readonly mediaStartSec?: number;
}

/**
 * Everything a committed operation asks the editor to write, one edit per clip.
 *
 * Walks composites, so an edit with consequences — a ripple trim's later clips,
 * a linked partner — reaches the document whole, in the one bracket the caller
 * writes it in.
 */
export function contentEditsOf(
	operation: Operation,
	sourceClip: (id: string) => Clip | undefined = () => undefined,
): ContentEdit[] {
	const edits = new Map<ItemId, ContentEdit>();
	const record = (id: ItemId, patch: Partial<ContentEdit>): void => {
		edits.set(id, { ...(edits.get(id) ?? { clipId: id }), ...patch, clipId: id });
	};
	const walk = (current: Operation): void => {
		switch (current.type) {
			case "move":
				for (const entry of current.entries)
					record(entry.id, {
						startSec: ticksToSeconds(entry.to.startTicks),
						track: laneTrackOf(entry.to.rowId),
					});
				return;
			case "reshape":
				for (const entry of current.entries) {
					const clip = sourceClip(entry.id),
						range = clip && clipSourceRange(clip);
					const from = clip ? ticksToSeconds(entry.to.startTicks) - clip.startSec : 0;
					const sourceStart =
						clip && range
							? sliceSourceInterval(
									range.start,
									clip.durationSec,
									range.rate,
									range.reverse,
									from,
									from + ticksToSeconds(entry.to.durationTicks),
								).start
							: undefined;
					/* A head trim moves the media with the edge. The library reports
					 * the source in-point it computed; the editor stores it in
					 * seconds on the clip's own family payload. */
					record(entry.id, {
						startSec: ticksToSeconds(entry.to.startTicks),
						durSec: ticksToSeconds(entry.to.durationTicks),
						mediaStartSec:
							sourceStart ??
							(entry.to.sourceInTicks === undefined
								? undefined
								: ticksToSeconds(entry.to.sourceInTicks)),
					});
				}
				return;
			case "composite":
				for (const member of current.operations) walk(member);
				return;
			case "insert":
			case "marker":
			case "remove":
				return;
		}
	};
	walk(operation);
	return [...edits.values()];
}
