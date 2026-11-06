/* What a volume fader's position means.
 *
 * The stored value is AMPLITUDE, what the renderer multiplies the signal by.
 * The fader is calibrated in decibels: 100 is unity, 0 is silence, and every
 * step in between is the same number of decibels, so a bed under narration is
 * mixable rather than an on/off switch. The rules live in the shared core
 * (`crates/app-core/src/controls.rs`, `p1-envelope-inspector`), so every client
 * maps a fader the same way. */
export {
	dbFromGain,
	faderFromGain,
	faderRangeDb,
	formatGainDb,
	gainFromDb,
	gainFromFader,
} from "@maleo/shared/editor/inspector-rules";
