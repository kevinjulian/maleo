/* React's view of the active workspace.
 *
 * The value itself lives in `models/core/active-workspace.ts`, outside React,
 * because the api layer reads it on every scoped request and ranks below hooks.
 * This is only the subscription. */
import { useCallback, useSyncExternalStore } from "react";
import {
	getActiveWorkspace,
	setActiveWorkspace,
	subscribeActiveWorkspace,
} from "@models/core/active-workspace.ts";

/** The active workspace, re-rendering the caller when it changes. */
export function useActiveWorkspace(): string {
	return useSyncExternalStore(subscribeActiveWorkspace, getActiveWorkspace, getActiveWorkspace);
}

/** The active workspace and the one control that changes it. */
export function useWorkspaceSwitch(): [string, (name: string) => void] {
	const workspace = useActiveWorkspace();
	const switchTo = useCallback((name: string) => setActiveWorkspace(name), []);
	return [workspace, switchTo];
}
