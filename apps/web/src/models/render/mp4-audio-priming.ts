/* AAC encoder priming in an MP4 file (OpenSpec p2-export E2).
 *
 * An AAC encoder emits priming samples before the first input sample. WebCodecs
 * does not report how many, and MediaBunny writes no edit list for them, so a
 * player would start the audio that many samples late. `withAudioPriming`
 * inserts the standard signal: an `edts/elst` in the sound track whose media
 * time skips the priming. Every chunk offset that follows the inserted bytes
 * moves with them. */

interface Box {
	type: string;
	start: number;
	/** Offset of the first child or payload byte. */
	body: number;
	end: number;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);

function boxes(view: DataView, from: number, to: number): Box[] {
	const out: Box[] = [];
	let at = from;
	while (at + 8 <= to) {
		let size = view.getUint32(at);
		const type = String.fromCharCode(
			view.getUint8(at + 4),
			view.getUint8(at + 5),
			view.getUint8(at + 6),
			view.getUint8(at + 7),
		);
		let body = at + 8;
		if (size === 1) {
			size = Number(view.getBigUint64(at + 8));
			body = at + 16;
		} else if (size === 0) size = to - at;
		if (size < body - at || at + size > to) throw new Error(`Malformed MP4 box ${type}`);
		out.push({ type, start: at, body, end: at + size });
		at += size;
	}
	return out;
}

function child(view: DataView, parent: Box, type: string): Box | undefined {
	return boxes(view, parent.body, parent.end).find((box) => box.type === type);
}

function required(view: DataView, parent: Box, type: string): Box {
	const found = child(view, parent, type);
	if (!found) throw new Error(`MP4 ${parent.type} has no ${type}`);
	return found;
}

/** Media timescale and duration from `mdhd` (version 0 or 1). */
function mediaHeader(view: DataView, mdhd: Box): { timescale: number; duration: number } {
	const version = view.getUint8(mdhd.body);
	return version === 1
		? {
				timescale: view.getUint32(mdhd.body + 20),
				duration: Number(view.getBigUint64(mdhd.body + 24)),
			}
		: { timescale: view.getUint32(mdhd.body + 12), duration: view.getUint32(mdhd.body + 16) };
}

function movieTimescale(view: DataView, mvhd: Box): number {
	return view.getUint32(mvhd.body + (view.getUint8(mvhd.body) === 1 ? 20 : 12));
}

function handler(view: DataView, trak: Box): string {
	const hdlr = required(view, required(view, trak, "mdia"), "hdlr");
	return String.fromCharCode(
		view.getUint8(hdlr.body + 8),
		view.getUint8(hdlr.body + 9),
		view.getUint8(hdlr.body + 10),
		view.getUint8(hdlr.body + 11),
	);
}

/** `edts` holding one edit: `segment` movie-timescale units of media from `mediaTime`. */
function editBox(segment: number, mediaTime: number): Uint8Array {
	const bytes = new Uint8Array(36);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 36);
	bytes.set([0x65, 0x64, 0x74, 0x73], 4); // edts
	view.setUint32(8, 28);
	bytes.set([0x65, 0x6c, 0x73, 0x74], 12); // elst, version 0, flags 0
	view.setUint32(20, 1); // entry count
	view.setUint32(24, segment);
	view.setInt32(28, mediaTime);
	view.setInt16(32, 1); // media rate 1.0
	return bytes;
}

/** Every chunk offset table in the movie, for moving offsets past the insert. */
function chunkOffsetTables(view: DataView, moov: Box): Box[] {
	const out: Box[] = [];
	const walk = (box: Box): void => {
		for (const inner of boxes(view, box.body, box.end)) {
			if (inner.type === "stco" || inner.type === "co64") out.push(inner);
			else if (CONTAINERS.has(inner.type)) walk(inner);
		}
	};
	walk(moov);
	return out;
}

/**
 * Returns a copy of `file` whose sound track skips `priming` leading samples
 * (in the track's media timescale). Zero priming returns the file unchanged.
 */
export function withAudioPriming(file: Uint8Array, priming: number): Uint8Array {
	if (!Number.isSafeInteger(priming) || priming < 0) throw new Error("Invalid audio priming");
	if (priming === 0) return file;
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const top = boxes(view, 0, file.byteLength);
	const moov = top.find((box) => box.type === "moov");
	if (!moov) throw new Error("MP4 has no moov");
	const sound = boxes(view, moov.body, moov.end).find(
		(box) => box.type === "trak" && handler(view, box) === "soun",
	);
	if (!sound) throw new Error("MP4 has no sound track");
	if (child(view, sound, "edts")) throw new Error("MP4 sound track already has an edit list");
	const media = mediaHeader(view, required(view, required(view, sound, "mdia"), "mdhd"));
	if (priming >= media.duration) throw new Error("Audio priming exceeds the sound track");
	const segment = Math.round(
		((media.duration - priming) / media.timescale) *
			movieTimescale(view, required(view, moov, "mvhd")),
	);
	const edit = editBox(segment, priming);
	const insertAt = required(view, sound, "tkhd").end;
	const moovBeforeData = top.some((box) => box.type === "mdat" && box.start > moov.start);

	const out = new Uint8Array(file.byteLength + edit.byteLength);
	out.set(file.subarray(0, insertAt), 0);
	out.set(edit, insertAt);
	out.set(file.subarray(insertAt), insertAt + edit.byteLength);
	const patched = new DataView(out.buffer);
	for (const box of [moov, sound]) {
		if (view.getUint32(box.start) === 1) throw new Error(`MP4 ${box.type} uses a 64-bit size`);
		patched.setUint32(box.start, box.end - box.start + edit.byteLength);
	}
	if (moovBeforeData)
		for (const table of chunkOffsetTables(view, moov)) {
			// Tables after the insert point moved too.
			const at = table.start >= insertAt ? edit.byteLength : 0;
			const count = view.getUint32(table.body + 4);
			for (let entry = 0; entry < count; entry++) {
				if (table.type === "stco") {
					const offset = table.body + 8 + entry * 4 + at;
					patched.setUint32(offset, patched.getUint32(offset) + edit.byteLength);
				} else {
					const offset = table.body + 8 + entry * 8 + at;
					patched.setBigUint64(offset, patched.getBigUint64(offset) + BigInt(edit.byteLength));
				}
			}
		}
	return out;
}

/** The sample index of the largest absolute value in a channel. */
export function peakIndex(samples: Float32Array): number {
	let best = 0;
	for (let index = 1; index < samples.length; index++)
		if (Math.abs(samples[index]!) > Math.abs(samples[best]!)) best = index;
	return best;
}
