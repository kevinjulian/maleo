/* "Expand into clips" in the clip menu (motion-design-generation, D9): replaces a
 * selected motion clip with one editable clip per layer, as one undo step. */
import { expandMotionCommand, motionExpandRefusal } from "@models/timeline/motion-expand.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";

export function ExpandMotionItem({
	ids,
	store,
	writers,
	onDone,
}: {
	ids: readonly string[];
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	onDone: () => void;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const id = ids.length === 1 ? ids[0] : undefined;
	const isMotion =
		id !== undefined && doc.clips.find((c) => c.id === id)?.text?.preset === "motion-comp";
	if (!id || !isMotion) return null;
	const refusal = motionExpandRefusal(doc, id);
	return (
		<button
			type="button"
			role="menuitem"
			disabled={refusal !== null}
			title={refusal ?? "Replace this motion with one editable clip per layer"}
			onClick={() => {
				writers.apply((scope) => expandMotionCommand(scope, id));
				onDone();
			}}
		>
			{Ic.layers(ICON.sm)} Expand into clips
		</button>
	);
}
