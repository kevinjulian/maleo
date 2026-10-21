/* The words the settings panel says, in one place.
 *
 * The panel's model is Defaults (reusable sources of values) and Elements (the values a
 * project receives from them). "Defaulter", "push", "override" and "operator" are how the
 * code names those things; none of them are what a person calls them, and shipping the
 * implementation's vocabulary made the model look harder than it is.
 *
 * Two of these labels are the same act with different promises, which is why they are two
 * labels and not one. "Use default" goes back to a NAMED default's value; "Reset to
 * shipped default" goes back to what ships in code, because the element has no default
 * source to return to. Saying "Use default" in the second case would promise a default
 * that does not exist. The same reasoning splits the write-back: "Update default" edits a
 * writable record, while a built-in cannot be edited at all, so pushing into one makes a
 * copy — and the word has to say so, or the operator expects the shipped default to move.
 */
export const PANEL_COPY = {
	/** Open the element's detail to edit it. */
	change: "Change",
	/** Discard the project's value; the element inherits from its named default again. */
	useDefault: "Use default",
	/** Discard the project's value where no default source is known. */
	resetToShipped: "Reset to shipped default",
	/** Write the project's value into a writable default. */
	updateDefault: "Update default",
	/** Fork a built-in default into a writable copy and write there. */
	saveAsCustomDefault: "Save as custom default",
	/** Row/group state: the project owns this value. */
	changed: "Changed",
	/** Row/group state: a default supplies this value. */
	inherited: "Inherited",
	/** Group header where inherited rows come from more than one default. */
	multipleDefaults: "Multiple defaults",
	/** Group header where no default supplies anything the group covers. */
	noDefault: "No default",
} as const;
