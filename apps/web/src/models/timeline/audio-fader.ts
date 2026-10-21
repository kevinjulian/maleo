/* What a volume fader's position means.
 *
 * The stored value is AMPLITUDE — what the renderer multiplies the signal by,
 * and what `<audio>.volume` takes. Amplitude is not loudness: halving it is a
 * 6 dB drop, and the ear hears roughly equal steps in dB rather than in
 * amplitude. A slider that maps its position straight onto amplitude therefore
 * spends most of its travel on changes that are hard to hear and crams the
 * audible range into the bottom of the scale.
 *
 * That is what made the volume control read as broken. Measured on a real
 * project: a bed at 10% and the same bed at 100% both sit far under a
 * narration at 1.0, so the whole fader felt like an on/off switch — the only
 * position that clearly did something was zero.
 *
 * So the fader is calibrated in decibels: 100 is unity, 0 is silence, and every
 * step in between is the same number of decibels. The stored value does not
 * change meaning, which is the point — no migration, no render change, and a
 * project mixed before this still plays exactly as it did.
 */

/** How far below unity the bottom of the fader sits, in decibels. Chosen to
 *  match a typical NLE clip fader: enough range to mix a bed under narration,
 *  not so much that the last few percent are inaudible steps. */
export const FADER_RANGE_DB = 48;

/** The amplitude a fader position produces. `pct` is 0..100. */
export function gainFromFader(pct: number): number {
	const clamped = Math.max(0, Math.min(100, pct));
	if (clamped <= 0) return 0;
	const db = (clamped - 100) * (FADER_RANGE_DB / 100);
	return 10 ** (db / 20);
}

/** Where a stored amplitude sits on the fader. The inverse of `gainFromFader`,
 *  so a value round-trips through the control unchanged. */
export function faderFromGain(gain: number): number {
	if (!(gain > 0)) return 0;
	const db = 20 * Math.log10(Math.min(1, gain));
	return Math.max(0, Math.min(100, 100 + db * (100 / FADER_RANGE_DB)));
}

/** An amplitude as decibels relative to unity. `-Infinity` when silent. */
export function dbFromGain(gain: number): number {
	return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

/** How an amplitude reads next to the fader: "-6.0 dB", or "muted". */
export function formatGainDb(gain: number): string {
	if (!(gain > 0)) return "muted";
	const db = dbFromGain(gain);
	return `${db > -0.05 ? "0.0" : db.toFixed(1)} dB`;
}
