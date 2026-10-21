/* What this model cannot be handed, enforced before the request.
 *
 * Both limits come from the model card and are properties of the weights. The
 * two get opposite treatment on purpose:
 *
 *   DIGITS ARE REFUSED. The model does not read "15" as "lima belas" — it
 *   mispronounces or drops it, and returns perfectly ordinary-sounding audio
 *   while doing so. There is no signal at the call site, so the failure is
 *   invisible until someone listens. A refusal naming the offending text is the
 *   only version of this the caller can act on. Normalizing here is not an
 *   option either: spelling a number in Indonesian is a language decision
 *   (ordinal, cardinal, year, currency) and a provider guessing it would be a
 *   silent rewrite of what the writer wrote.
 *
 *   EXCLAMATION MARKS ARE REPLACED with a full stop. They are unsupported
 *   punctuation, not content, and the substitution changes the words not at
 *   all — where refusing would fail an otherwise speakable line over a
 *   character the model simply has no token for.
 */

const DIGITS = /\d/;

export class PocketTtsTextError extends Error {}

/** The text as the model may receive it. Throws when it cannot be spoken. */
export function prepareIndonesianText(text: string): string {
	if (DIGITS.test(text)) {
		throw new PocketTtsTextError(
			"Pocket TTS Indonesian cannot read digits — write numbers as words " +
				'(e.g. "lima belas", not "15"). Offending text: ' +
				JSON.stringify(text.slice(0, 120)),
		);
	}
	return text.replaceAll("!", ".");
}
