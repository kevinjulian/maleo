/* What a key press in a text field means.
 *
 * Enter has three meanings in a composer and the handlers disagreed about
 * them: submit, a new line (with Shift), and — while an input method is
 * composing — "accept this candidate", which is not a press of Enter at all as
 * far as the person typing is concerned. Japanese, Chinese and Korean are
 * typed that way; a composer that submits on the confirming Enter sends half a
 * sentence every time. One composer checked for composition, two did not, and
 * none handled Safari, which reports the confirming keydown AFTER composition
 * has ended (`isComposing` false) with the legacy `keyCode` 229.
 */

/** The parts of a keyboard event these read. A React or a DOM event fits. */
export type KeyLike = {
	key: string;
	shiftKey?: boolean;
	keyCode?: number;
	isComposing?: boolean;
	nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/** The press belongs to an input method, not to the field's own shortcuts. */
export function isComposingKey(event: KeyLike): boolean {
	return (
		event.isComposing === true ||
		event.nativeEvent?.isComposing === true ||
		event.keyCode === 229 ||
		event.nativeEvent?.keyCode === 229
	);
}

/** Enter that means "send": no Shift (that is a new line) and no composition. */
export function isSubmitEnter(event: KeyLike): boolean {
	return event.key === "Enter" && event.shiftKey !== true && !isComposingKey(event);
}

/** Enter that means "commit this single-line value": Shift does not matter,
 *  composition still does. */
export function isCommitEnter(event: KeyLike): boolean {
	return event.key === "Enter" && !isComposingKey(event);
}
