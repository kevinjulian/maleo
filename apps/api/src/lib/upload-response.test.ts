/* Range behaviour on the upload route, asserted on the wire.
 *
 * This defect cannot be observed by opening the app. Every browser used for
 * development tolerates a rangeless server, so a voiceover that iOS silently
 * refuses to play looks completely fine on a desktop — and it did, for as long
 * as the route existed. It was found by reading a response with `curl`, and only
 * a test that reads a response will keep it fixed.
 *
 * The assertions are on status, `Content-Range`, `Content-Length` and body
 * CONTENT rather than status alone. Content matters for the suffix case in
 * particular: `bytes=-n` means the last n bytes, and an implementation that
 * reads it as the first n still returns a `206` of the right length.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildUploadResponse, parseRangeHeader, type ServableFile } from "./upload-response.ts";

/** A file with known contents, so intervals can be checked by value.
 *  Bytes are 0,1,2,…,size-1 modulo 256, so any interval is self-identifying. */
function fakeFile(size: number, type = "audio/x-wav", exists = true): ServableFile {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = i % 256;
	return {
		size,
		type,
		exists: async () => exists,
		slice: (start, end) => new Blob([bytes.slice(start, end)], { type }),
	};
}

async function bodyBytes(res: Response): Promise<Uint8Array> {
	return new Uint8Array(await res.arrayBuffer());
}

describe("parseRangeHeader", () => {
	test("absent or non-byte units serve the whole file", () => {
		expect(parseRangeHeader(null, 100)).toEqual({ kind: "none" });
		expect(parseRangeHeader(undefined, 100)).toEqual({ kind: "none" });
		expect(parseRangeHeader("items=0-1", 100)).toEqual({ kind: "none" });
	});

	test("a closed interval is clamped to the file", () => {
		expect(parseRangeHeader("bytes=0-1", 100)).toEqual({ kind: "range", start: 0, end: 1 });
		expect(parseRangeHeader("bytes=10-999", 100)).toEqual({ kind: "range", start: 10, end: 99 });
	});

	test("an open-ended interval runs to the final byte", () => {
		expect(parseRangeHeader("bytes=40-", 100)).toEqual({ kind: "range", start: 40, end: 99 });
	});

	test("a suffix interval is the LAST n bytes", () => {
		// The case an inverted implementation still passes on length alone.
		expect(parseRangeHeader("bytes=-10", 100)).toEqual({ kind: "range", start: 90, end: 99 });
		// A suffix longer than the file is the whole file, not an error.
		expect(parseRangeHeader("bytes=-500", 100)).toEqual({ kind: "range", start: 0, end: 99 });
	});

	test("intervals outside the file are unsatisfiable, not widened", () => {
		expect(parseRangeHeader("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
		expect(parseRangeHeader("bytes=200-300", 100)).toEqual({ kind: "unsatisfiable" });
		expect(parseRangeHeader("bytes=50-40", 100)).toEqual({ kind: "unsatisfiable" });
		expect(parseRangeHeader("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
		expect(parseRangeHeader("bytes=0-1", 0)).toEqual({ kind: "unsatisfiable" });
	});

	test("garbage is treated as absent rather than failing the request", () => {
		expect(parseRangeHeader("bytes=abc", 100)).toEqual({ kind: "none" });
		expect(parseRangeHeader("bytes=", 100)).toEqual({ kind: "none" });
		expect(parseRangeHeader("bytes=1-x", 100)).toEqual({ kind: "none" });
	});

	test("multi-interval requests are ignored, not partially answered", () => {
		// Serving only the first interval of a multi-range request would be a lie
		// about what was returned; no media element asks for one.
		expect(parseRangeHeader("bytes=0-99, 200-299", 1000)).toEqual({ kind: "none" });
	});
});

describe("buildUploadResponse", () => {
	test("a media element's probe gets 206 with two bytes", async () => {
		// The exact request iOS sends, and the exact response it needs. This is the
		// regression that made generated voiceover silent on a phone.
		const res = await buildUploadResponse(fakeFile(240044), "bytes=0-1");
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 0-1/240044");
		expect(res.headers.get("content-length")).toBe("2");
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(await bodyBytes(res)).toEqual(new Uint8Array([0, 1]));
	});

	test("an unranged request gets the whole file and advertises range support", async () => {
		const res = await buildUploadResponse(fakeFile(100), null);
		expect(res.status).toBe(200);
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(res.headers.get("content-length")).toBe("100");
		expect((await bodyBytes(res)).length).toBe(100);
	});

	test("an open-ended range runs to the end of the file", async () => {
		const res = await buildUploadResponse(fakeFile(100), "bytes=98-");
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 98-99/100");
		expect(await bodyBytes(res)).toEqual(new Uint8Array([98, 99]));
	});

	test("a suffix range returns the final bytes, by value", async () => {
		const res = await buildUploadResponse(fakeFile(100), "bytes=-3");
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 97-99/100");
		// Asserting content, not just length: reading `-3` as "first 3" yields a
		// 206 of the same length carrying [0,1,2].
		expect(await bodyBytes(res)).toEqual(new Uint8Array([97, 98, 99]));
	});

	test("a range past the end is refused, not widened to the whole file", async () => {
		// Falling back to 200 here is the original bug wearing a different hat.
		const res = await buildUploadResponse(fakeFile(100), "bytes=500-600");
		expect(res.status).toBe(416);
		expect(res.headers.get("content-range")).toBe("bytes */100");
		expect((await bodyBytes(res)).length).toBe(0);
	});

	test("an unparseable range serves the whole file rather than failing", async () => {
		const res = await buildUploadResponse(fakeFile(100), "bytes=nonsense");
		expect(res.status).toBe(200);
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect((await bodyBytes(res)).length).toBe(100);
	});

	test("caching and content type survive every response shape", async () => {
		// Passing a headers object to `new Response(bunFile)` drops Bun's inferred
		// content type. A .wav served as octet-stream is another way to make a
		// media element refuse — the same class of failure this module removes.
		for (const range of [null, "bytes=0-1", "bytes=500-600"]) {
			const res = await buildUploadResponse(fakeFile(100), range);
			expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
			expect(res.headers.get("content-type")).toBe("audio/x-wav");
		}
	});

	test("a missing file is 404 whether or not a range was asked for", async () => {
		for (const range of [null, "bytes=0-1"]) {
			const res = await buildUploadResponse(fakeFile(100, "audio/x-wav", false), range);
			expect(res.status).toBe(404);
		}
	});
});
