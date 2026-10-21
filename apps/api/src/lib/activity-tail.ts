import { existsSync, statSync } from "node:fs";
import { activityPath } from "./workspace-paths.ts";
import { fieldOf } from "@maleo/shared";

export interface ActivityPage {
	items: unknown[];
	// File total line count is expensive to compute; left null. `has_more` true if
	// we found items at or before the requested before-cursor and didn't hit BOF.
	has_more: boolean;
	// Oldest line timestamp returned — pass as next `before` for older page.
	next_before: number | null;
}

// Read up to maxLines newest entries from activity.jsonl. If `before` is set,
// returns entries strictly older than that timestamp. Scans backward in chunks
// until enough lines or BOF reached.
export async function tailActivity(
	workspace: string,
	maxLines = 200,
	before?: number,
): Promise<ActivityPage> {
	const path = activityPath(workspace);
	if (!existsSync(path)) {
		return { items: [], has_more: false, next_before: null };
	}
	const size = statSync(path).size;
	if (size === 0) return { items: [], has_more: false, next_before: null };

	const collected: unknown[] = [];
	const CHUNK = 128 * 1024;
	let endPos = size;
	let hitBof = false;
	let leftover = "";
	while (collected.length < maxLines && endPos > 0) {
		const readSize = Math.min(CHUNK, endPos);
		const startPos = endPos - readSize;
		const file = Bun.file(path);
		const buf = new Uint8Array(await file.slice(startPos, endPos).arrayBuffer());
		const text = new TextDecoder().decode(buf) + leftover;
		endPos = startPos;
		if (startPos === 0) hitBof = true;
		// Split — drop first partial line unless we hit BOF.
		const lines = text.split("\n");
		if (!hitBof) {
			leftover = lines.shift() ?? "";
		} else {
			leftover = "";
		}
		// Walk lines newest→oldest. They're in file order (oldest→newest), so iterate from end.
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			let parsed: any;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof before === "number") {
				const ts =
					typeof parsed?.ts === "number"
						? parsed.ts
						: typeof parsed?.t === "number"
							? parsed.t
							: null;
				if (ts !== null && ts >= before) continue;
			}
			collected.push(parsed);
			if (collected.length >= maxLines) break;
		}
	}

	// Reverse to chronological (oldest→newest) order for client consumption.
	const items = collected.reverse();
	const oldest = items.length > 0 ? items[0] : null;
	/* An activity line carries its timestamp as `ts` or, in older rows, `t`.
	 * `fieldOf` reads either off a value nothing has parsed, which is what these
	 * lines are — the `as any` this replaces turned off checking entirely to
	 * reach two numbers. */
	const tsField = fieldOf(oldest, "ts");
	const tField = fieldOf(oldest, "t");
	const next_before =
		typeof tsField === "number" ? tsField : typeof tField === "number" ? tField : null;
	return {
		items,
		has_more: !hitBof,
		next_before,
	};
}

// SSE-friendly: incrementally yield new lines as file grows.
export async function* streamActivity(
	workspace: string,
	abortSignal: AbortSignal,
): AsyncGenerator<unknown> {
	const path = activityPath(workspace);
	let lastSize = existsSync(path) ? statSync(path).size : 0;
	while (!abortSignal.aborted) {
		await new Promise((r) => setTimeout(r, 800));
		if (!existsSync(path)) continue;
		const size = statSync(path).size;
		if (size <= lastSize) continue;
		const file = Bun.file(path);
		const buf = new Uint8Array(await file.slice(lastSize, size).arrayBuffer());
		lastSize = size;
		const text = new TextDecoder().decode(buf);
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				yield JSON.parse(line);
			} catch {
				/* skip */
			}
		}
	}
}
