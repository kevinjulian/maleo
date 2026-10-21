/* The note a reference modal submits. A plain record, so the writers that
 * persist one do not depend on the modal that collects it. */

export interface NotePayload {
	label: string;
	body: string;
	tags: string[];
	proofSource?: string;
	proofUrl?: string;
}
