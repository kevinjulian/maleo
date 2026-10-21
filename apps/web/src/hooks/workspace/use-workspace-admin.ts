/* The Manage surface's state.
 *
 * One hook for all three panels, because they share the thing that decides
 * what any of them may offer: the caller's role in this workspace. Splitting it
 * per panel would mean three fetches answering the same question, and three
 * chances to disagree about it.
 */
import { useCallback, useEffect, useState } from "react";
import {
	createInvitation,
	deleteWorkspace,
	readMembers,
	readWorkspace,
	removeMember,
	revokeInvitation,
	saveWorkspace,
	type MembersView,
	type WorkspaceDetail,
} from "@api/workspace-admin.ts";

export interface WorkspaceAdmin {
	detail: WorkspaceDetail | null;
	members: MembersView | null;
	loading: boolean;
	error: string | null;
	/** True when the caller owns this workspace. Controls are hidden otherwise. */
	isOwner: boolean;
	save: (patch: { display_name?: string; description?: string | null }) => Promise<void>;
	invite: () => Promise<string>;
	revoke: (id: string) => Promise<void>;
	remove: (userId: string) => Promise<void>;
	destroy: (confirmName: string) => Promise<void>;
	reload: () => void;
}

/** The message to show, preferring what the API said over a status code. */
function messageOf(err: unknown): string {
	if (!(err instanceof Error)) return "Something went wrong.";
	// client.ts formats "path status: detail"; the detail is the useful half.
	const detail = err.message.split(": ").slice(1).join(": ");
	return detail || err.message;
}

export function useWorkspaceAdmin(workspace: string): WorkspaceAdmin {
	const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
	const [members, setMembers] = useState<MembersView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);

	const reload = useCallback(() => setNonce((n) => n + 1), []);

	useEffect(() => {
		let live = true;
		setLoading(true);
		setError(null);
		Promise.all([readWorkspace(workspace), readMembers(workspace)])
			.then(([d, m]) => {
				if (!live) return;
				setDetail(d.item);
				setMembers(m);
			})
			.catch((err: unknown) => {
				if (live) setError(messageOf(err));
			})
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [workspace, nonce]);

	/* Every mutation reloads rather than patching local state.
	 *
	 * The server decides things the client cannot predict — whether a removal was
	 * refused for being the last owner, what the member list looks like
	 * afterwards — and a surface that guessed would drift from it. These are
	 * rare, deliberate actions, so one extra round trip costs nothing anyone
	 * notices. */
	const afterChange = useCallback(
		async (run: () => Promise<unknown>) => {
			setError(null);
			try {
				await run();
				reload();
			} catch (err) {
				setError(messageOf(err));
				throw err;
			}
		},
		[reload],
	);

	return {
		detail,
		members,
		loading,
		error,
		isOwner: detail?.viewer_role === "owner",
		save: (patch) => afterChange(() => saveWorkspace(workspace, patch)),
		invite: async () => {
			setError(null);
			try {
				const created = await createInvitation(workspace);
				reload();
				// Returned, not stored: this is the only copy of the token.
				return created.token;
			} catch (err) {
				setError(messageOf(err));
				throw err;
			}
		},
		revoke: (id) => afterChange(() => revokeInvitation(workspace, id)),
		remove: (userId) => afterChange(() => removeMember(workspace, userId)),
		destroy: (confirmName) => afterChange(() => deleteWorkspace(workspace, confirmName)),
		reload,
	};
}
