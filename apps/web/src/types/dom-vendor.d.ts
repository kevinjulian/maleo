/* Vendor-prefixed DOM surface this app still has to reach for.
 *
 * Declared rather than asserted at each call site: two audio decoders were
 * carrying `window as unknown as { webkitAudioContext: typeof AudioContext }`,
 * which states the shape twice and checks it nowhere. Optional, because the
 * prefix is exactly what is absent on the browsers that ship the standard name. */
interface Window {
	webkitAudioContext?: typeof AudioContext;
}
