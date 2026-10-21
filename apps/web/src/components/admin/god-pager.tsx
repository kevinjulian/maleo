import type { JSX } from "react";
import { ADMIN_PAGE_SIZE } from "@api/admin.ts";

/** Previous/next over one admin listing; hidden while everything fits on a page. */
export function GodPager({
	offset,
	total,
	onOffset,
}: {
	offset: number;
	total: number;
	onOffset: (next: number) => void;
}): JSX.Element | null {
	if (total <= ADMIN_PAGE_SIZE) return null;
	return (
		<div className="god-pager">
			<button
				type="button"
				disabled={offset === 0}
				onClick={() => onOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}
			>
				Previous
			</button>
			<span>
				{offset + 1}–{Math.min(offset + ADMIN_PAGE_SIZE, total)} of {total}
			</span>
			<button
				type="button"
				disabled={offset + ADMIN_PAGE_SIZE >= total}
				onClick={() => onOffset(offset + ADMIN_PAGE_SIZE)}
			>
				Next
			</button>
		</div>
	);
}
