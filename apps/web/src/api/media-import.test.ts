import { expect, test } from "vite-plus/test";
import { ApiError } from "./client.ts";
import { mediaImportError } from "./media-import.ts";

const html =
	"<!DOCTYPE html><html><head><title>example.com | 502: Bad gateway</title></head><body>Cloudflare</body></html>";

test("a gateway's HTML error page becomes a short, actionable message", () => {
	for (const status of [502, 503, 504, 520, 522, 524]) {
		const message = mediaImportError(new ApiError(status, `/api/x ${status}: ${html}`, html));
		expect(message).toBe(`Upload service unavailable (HTTP ${status}). Retry in a moment.`);
		expect(message).not.toContain("<");
	}
	expect(mediaImportError(new ApiError(413, "/api/x 413: <html>", "<html>"))).toBe(
		"File is larger than the server or its proxy accepts (HTTP 413).",
	);
	expect(mediaImportError(new ApiError(500, "/api/x 500: oops", "oops"))).toBe(
		"Upload failed (HTTP 500). Retry in a moment.",
	);
});

test("an authored API message is still shown as written", () => {
	expect(
		mediaImportError(
			new ApiError(409, "x", { message: "Upload retry does not match original file" }),
		),
	).toBe("Upload retry does not match original file");
});

test("a network failure says so instead of echoing transport internals", () => {
	expect(mediaImportError(new TypeError("Failed to fetch"))).toBe(
		"Network connection lost. Retry when online.",
	);
});
