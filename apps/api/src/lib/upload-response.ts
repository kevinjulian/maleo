/* Serving files out of `public/uploads`, with HTTP byte ranges.
 *
 * The ranges are not an optimization. iOS Safari refuses to play network media
 * from a server that does not honour them: it probes with `Range: bytes=0-1`,
 * and a `200` carrying the whole body is read as a refusal — playback never
 * starts and nothing is surfaced to the page. `fetch()` imposes no such
 * requirement, which is why a generated voiceover could draw its waveform
 * (decoded through `fetch` + `decodeAudioData`) and be silent in the same
 * session, and why every desktop browser hid this for as long as it did.
 *
 * Stock music and SFX are CDN URLs and were always ranged correctly. Voiceover
 * is the first thing this route served to a media element on a phone; uploaded
 * video is the next one, and has the same defect for the same reason.
 *
 * Split out of `index.ts` because that module starts a server at import time,
 * so the behaviour could not otherwise be tested. A `Response` IS the wire
 * contract here, so the tests assert against one directly.
 */

/** Where a parse of the `Range` header lands. */
export type ParsedRange =
	/** No range asked for, or one that cannot be honoured as written — serve whole. */
	| { kind: "none" }
	/** Syntactically fine, but outside the file. Must be refused, not widened. */
	| { kind: "unsatisfiable" }
	/** Inclusive byte interval, already clamped to the file. */
	| { kind: "range"; start: number; end: number };

const RANGE_PREFIX = "bytes=";

/* Parse a `Range` header against a known size.
 *
 * Three spellings, and the third is the one that gets written backwards:
 *
 *   bytes=0-1     the FIRST two bytes          → [0, 1]
 *   bytes=500-    from 500 to the end          → [500, size-1]
 *   bytes=-500    the LAST 500 bytes           → [size-500, size-1]
 *
 * `bytes=-500` is not "up to 500". Reading it that way yields a plausible `206`
 * that serves the wrong audio, which is worse than the silence this fixes
 * because it looks like it works.
 *
 * Anything unparseable returns `none` rather than an error: a malformed header
 * is not worth failing a request over, and a whole-file `200` is what a client
 * that sent nonsense would have got anyway. Multi-interval requests
 * (`bytes=0-99, 200-299`) also return `none` — a single-interval server may
 * ignore them, no media element asks for them, and ignoring is safer than
 * silently answering only the first interval. */
export function parseRangeHeader(header: string | null | undefined, size: number): ParsedRange {
	if (!header) return { kind: "none" };
	const trimmed = header.trim();
	if (!trimmed.toLowerCase().startsWith(RANGE_PREFIX)) return { kind: "none" };
	const spec = trimmed.slice(RANGE_PREFIX.length).trim();
	// Multi-interval: not supported, and deliberately not partially answered.
	if (spec.includes(",")) return { kind: "none" };
	const dash = spec.indexOf("-");
	if (dash < 0) return { kind: "none" };

	const rawStart = spec.slice(0, dash).trim();
	const rawEnd = spec.slice(dash + 1).trim();

	// An empty file cannot satisfy any interval, including a suffix.
	if (size <= 0) return { kind: "unsatisfiable" };

	// Suffix form: `bytes=-n` is the LAST n bytes.
	if (rawStart === "") {
		if (!/^\d+$/.test(rawEnd)) return { kind: "none" };
		const wanted = Number(rawEnd);
		// `bytes=-0` asks for nothing, which is not a satisfiable interval.
		if (wanted <= 0) return { kind: "unsatisfiable" };
		const start = Math.max(0, size - wanted);
		return { kind: "range", start, end: size - 1 };
	}

	if (!/^\d+$/.test(rawStart)) return { kind: "none" };
	const start = Number(rawStart);
	// Past the end: refuse. Widening to a `200` here is precisely the bug.
	if (start >= size) return { kind: "unsatisfiable" };

	// Open-ended form: `bytes=n-` runs to the final byte.
	if (rawEnd === "") return { kind: "range", start, end: size - 1 };

	if (!/^\d+$/.test(rawEnd)) return { kind: "none" };
	const requestedEnd = Number(rawEnd);
	if (requestedEnd < start) return { kind: "unsatisfiable" };
	// A client may ask past the end; clamp rather than refuse.
	return { kind: "range", start, end: Math.min(requestedEnd, size - 1) };
}

/** Cache directive every upload response carries, ranged or not. */
const CACHE_CONTROL = "public, max-age=3600";

/* Headers shared by every shape.
 *
 * `content-type` is set explicitly rather than left to Bun's inference. Passing
 * a `headers` object to `new Response(bunFile, ...)` is what drops the inferred
 * type, and a `.wav` served as `application/octet-stream` is another way to make
 * a media element refuse to play — the same class of failure this module exists
 * to remove. */
function baseHeaders(contentType: string) {
	return {
		"cache-control": CACHE_CONTROL,
		"accept-ranges": "bytes",
		...(contentType ? { "content-type": contentType } : {}),
	};
}

/** The minimum surface this module needs from a file, so tests need no disk. */
export interface ServableFile {
	size: number;
	type: string;
	exists: () => Promise<boolean>;
	slice: (start: number, end: number) => Blob;
}

/** Build the response for an upload request: `206` for a satisfiable range,
 *  `416` for one that cannot be met, `200` otherwise, and `404` when the file
 *  is not there. */
export async function buildUploadResponse(
	file: ServableFile,
	rangeHeader: string | null | undefined,
): Promise<Response> {
	if (!(await file.exists())) return new Response("not_found", { status: 404 });

	const size = file.size;
	const parsed = parseRangeHeader(rangeHeader, size);

	if (parsed.kind === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { ...baseHeaders(file.type), "content-range": `bytes */${size}` },
		});
	}

	if (parsed.kind === "range") {
		const { start, end } = parsed;
		// `end` is inclusive on the wire and exclusive in `slice`.
		return new Response(file.slice(start, end + 1), {
			status: 206,
			headers: {
				...baseHeaders(file.type),
				"content-range": `bytes ${start}-${end}/${size}`,
				"content-length": String(end - start + 1),
			},
		});
	}

	return new Response(file.slice(0, size), {
		status: 200,
		headers: { ...baseHeaders(file.type), "content-length": String(size) },
	});
}
