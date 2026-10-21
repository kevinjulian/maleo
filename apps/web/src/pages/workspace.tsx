/* The Manage → Workspace route.
 *
 * A page composes; the surface it renders holds the state. Which panel is in
 * view comes from the address, so a link to Members opens Members. */
import type { JSX } from "react";
import { WorkspaceManage } from "@components/workspace/workspace-manage.tsx";
import type { WorkspacePanel } from "@models/core/routing.ts";

export interface WorkspacePageProps {
	workspace: string;
	panel: WorkspacePanel;
	onPanel: (panel: WorkspacePanel) => void;
	onDeleted: () => void;
}

export function WorkspacePage(props: WorkspacePageProps): JSX.Element {
	return (
		<WorkspaceManage
			workspace={props.workspace}
			panel={props.panel}
			onPanel={props.onPanel}
			onDeleted={props.onDeleted}
		/>
	);
}
