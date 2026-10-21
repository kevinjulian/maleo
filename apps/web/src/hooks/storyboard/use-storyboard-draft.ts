import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
	approveStoryboardDraft,
	loadStoryboardAuthoring,
	submitStoryboardCommand,
} from "@api/storyboard-authoring.ts";
import { StoryboardController } from "@models/storyboard/storyboard-controller.ts";

export function useStoryboardDraft(projectId: string) {
	const controller = useMemo(
		() =>
			new StoryboardController({
				load: () => loadStoryboardAuthoring(projectId),
				command: (revisionId, command) => submitStoryboardCommand(projectId, revisionId, command),
				approve: (revisionId, policy) => approveStoryboardDraft(projectId, revisionId, policy),
			}),
		[projectId],
	);
	const view = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	useEffect(() => {
		void controller.refresh();
	}, [controller]);
	return {
		...view,
		refresh: controller.refresh,
		selectBeat: controller.selectBeat,
		setTextDraft: controller.setTextDraft,
		submit: controller.submit,
		approve: controller.approve,
	};
}
