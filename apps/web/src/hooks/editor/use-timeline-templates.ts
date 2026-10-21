/* The workspace's timeline templates: the list, the in-flight state, and the
 * create/update operations.
 *
 * Definitions are workspace-global and never become project-owned — selecting
 * one persists only its id plus the applied editor values. That is why applying
 * a selection is a callback here rather than something this hook does: what a
 * selection changes (settings, the project's references) belongs to whoever
 * owns those, not to the list.
 */
import { useCallback, useEffect, useState } from "react";
import type { TimelineTemplate, TimelineTemplateInput } from "@maleo/shared";
import {
	createTimelineTemplate,
	listTimelineTemplates,
	updateTimelineTemplate,
} from "@api/templates.ts";

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export interface TimelineTemplates {
	items: TimelineTemplate[];
	setItems: (next: TimelineTemplate[] | ((prev: TimelineTemplate[]) => TimelineTemplate[])) => void;
	busy: boolean;
	error: string | null;
	/** Create a template, add it to the list, and apply it. */
	create: (input: TimelineTemplateInput) => Promise<TimelineTemplate>;
	/** Update a template; re-apply it only if it is the one in use. */
	update: (id: string, input: TimelineTemplateInput) => Promise<TimelineTemplate>;
}

export function useTimelineTemplates(args: {
	/** Apply a template to the project. Called on create, and on update only
	 *  when the edited template is the selected one. */
	onApply: (template: TimelineTemplate) => void;
	/** The template id currently in use, so an update knows whether to re-apply. */
	selectedId: () => string | undefined;
	/** Load the list only where it is used — the video editor. */
	enabled: boolean;
}): TimelineTemplates {
	const { onApply, selectedId, enabled } = args;
	const [items, setItems] = useState<TimelineTemplate[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let alive = true;
		setBusy(true);
		void listTimelineTemplates()
			.then((list) => {
				if (alive) setItems(list);
			})
			.catch((err) => {
				if (alive) setError(errMsg(err));
			})
			.finally(() => {
				if (alive) setBusy(false);
			});
		return () => {
			alive = false;
		};
	}, [enabled]);

	const create = useCallback(
		async (input: TimelineTemplateInput): Promise<TimelineTemplate> => {
			setBusy(true);
			setError(null);
			try {
				const item = await createTimelineTemplate(input);
				setItems((prev) => [item, ...prev]);
				onApply(item);
				return item;
			} catch (err) {
				setError(errMsg(err));
				throw err;
			} finally {
				setBusy(false);
			}
		},
		[onApply],
	);

	const update = useCallback(
		async (id: string, input: TimelineTemplateInput): Promise<TimelineTemplate> => {
			setBusy(true);
			setError(null);
			try {
				const item = await updateTimelineTemplate(id, input);
				setItems((prev) => prev.map((template) => (template.id === id ? item : template)));
				if (selectedId() === id) onApply(item);
				return item;
			} catch (err) {
				setError(errMsg(err));
				throw err;
			} finally {
				setBusy(false);
			}
		},
		[onApply, selectedId],
	);

	return { items, setItems, busy, error, create, update };
}
