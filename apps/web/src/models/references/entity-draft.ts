/* The reference entity form's draft shape. A plain record: the form that
 * edits one lives in references/ui/entity-editor.tsx. */

export interface EntityDraft {
	role: string;
	label: string;
	description: string;
	src?: string;
	/** The prompt that produced the image, kept so a generated reference can be
	 *  regenerated or traced later. */
	prompt?: string;
}
