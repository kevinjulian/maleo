import { expect, test, vi } from "vite-plus/test";
import { isMediaId, mediaUrl, mediaUrlId, mintMediaId } from "./media-id.ts";

test("a minted id is a version 7, RFC variant UUID", () => {
	const id = mintMediaId();
	expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	expect(isMediaId(id)).toBe(true);
});

test("a minted id carries the current Unix milliseconds", () => {
	vi.spyOn(Date, "now").mockReturnValue(0x0f23_4567_89ab);
	try {
		expect(mintMediaId().replace(/-/g, "").slice(0, 12)).toBe("0f23456789ab");
	} finally {
		vi.restoreAllMocks();
	}
});

test("two mints in the same millisecond keep creation order", () => {
	vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
	try {
		const ids = Array.from({ length: 50 }, () => mintMediaId());
		expect([...ids].sort()).toEqual(ids);
		expect(new Set(ids).size).toBe(ids.length);
	} finally {
		vi.restoreAllMocks();
	}
});

test("v4 UUIDs, request keys and malformed values are not media ids", () => {
	for (const value of [
		crypto.randomUUID(),
		"upload_1700000000000_abc",
		"0190a6c4-7b1e-7c3d-cf00-123456789abc", // variant bits wrong
		"0190A6C4-7B1E-7C3D-8F00-123456789ABC", // uppercase is not canonical
		"0190a6c47b1e7c3d8f00123456789abc",
		"",
		undefined,
		7,
	])
		expect(isMediaId(value)).toBe(false);
});

test("a stable media URL round-trips its identity", () => {
	const id = mintMediaId();
	expect(mediaUrlId(mediaUrl(id))).toBe(id);
	for (const value of [`pending:${id}`, `/api/media/${id}/sign`, `https://x/api/media/${id}`, 3])
		expect(mediaUrlId(value)).toBeUndefined();
});
