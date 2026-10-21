import { z } from "zod";

export const bookmarkSchema = z
	.object({
		id: z.string().min(1).max(160),
		timeSec: z.number().finite().min(0),
		label: z.string().trim().min(1).max(160),
	})
	.strict();
export type Bookmark = z.infer<typeof bookmarkSchema>;

const labelRepair = z.object({ label: z.unknown() }).passthrough();

/** A label is presentation, so a blank or overlong one is repaired rather than costing the bookmark. */
function repairLabel(item: unknown): unknown {
	const record = labelRepair.safeParse(item);
	if (!record.success) return item;
	const label = typeof record.data.label === "string" ? record.data.label.trim().slice(0, 160) : "";
	return { ...record.data, label: label || "Bookmark" };
}

/** Legacy absence stays absent; records without identity/time and duplicates never reach controls. */
export function parseBookmarks(value: unknown): Bookmark[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const seen = new Set<string>();
	return value.flatMap((item) => {
		const parsed = bookmarkSchema.safeParse(repairLabel(item));
		if (!parsed.success || seen.has(parsed.data.id)) return [];
		seen.add(parsed.data.id);
		return [parsed.data];
	});
}
