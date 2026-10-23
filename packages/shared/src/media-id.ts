import { z } from "zod";

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A client-minted media identity; it is also its import's request key. */
export const MediaIdSchema = z.string().regex(MEDIA_ID);

let lastMs = -1;
let counter = 0;

/** Client-minted media identity: a UUIDv7 (RFC 9562). Ids minted in one process
 *  in the same millisecond keep creation order through the 12-bit counter in rand_a. */
export function mintMediaId(): string {
	let ms = Date.now();
	if (ms <= lastMs) {
		ms = lastMs;
		counter++;
		if (counter > 0xfff) {
			ms++;
			counter = 0;
		}
	} else counter = 0;
	lastMs = ms;
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
	bytes[6] = 0x70 | (counter >> 8);
	bytes[7] = counter & 0xff;
	bytes[8] = 0x80 | (bytes[8]! & 0x3f);
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Strict, canonical (lowercase) UUIDv7 check. */
export function isMediaId(value: unknown): value is string {
	return typeof value === "string" && MEDIA_ID.test(value);
}

const MEDIA_URL = /^\/api\/media\/([0-9a-f-]{36})$/;

/** The stable media URL a document holds for a managed identity. */
export function mediaUrl(id: string): string {
	return `/api/media/${id}`;
}

/** The managed identity a stable media URL names; undefined for any other value. */
export function mediaUrlId(url: unknown): string | undefined {
	return typeof url === "string" ? MEDIA_URL.exec(url)?.[1] : undefined;
}
