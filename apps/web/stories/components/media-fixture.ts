/* Inline media for stories that need a real src: no network, no api origin.
 * `assetUrl` passes data URIs through untouched. */
const svg = (w: number, h: number, a: string, b: string): string =>
	`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.12}" fill="#fff" fill-opacity="0.7"/></svg>`)}`;

export const PORTRAIT_IMAGE = svg(360, 640, "#1f6f5c", "#9fd8c2");
export const SQUARE_IMAGE = svg(512, 512, "#3b2a6b", "#e0a3c8");

/* One second of a quiet 440Hz tone as a 16-bit mono WAV, built in memory. */
export function toneWav(seconds = 1, rate = 8000): string {
	const n = seconds * rate;
	const view = new DataView(new ArrayBuffer(44 + n * 2));
	const text = (at: number, s: string): void => {
		for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + n * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, n * 2, true);
	for (let i = 0; i < n; i++)
		view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), true);
	const bytes = new Uint8Array(view.buffer);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return `data:audio/wav;base64,${btoa(bin)}`;
}
