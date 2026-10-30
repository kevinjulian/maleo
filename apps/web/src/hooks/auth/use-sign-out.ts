/* Sign-out as state, so the control that offers it only renders the outcome.
 *
 * On success the stored workspace is forgotten before leaving: the next
 * account on this browser must not open in this one's workspace. On failure
 * nothing is left — the session is still live, and saying so is the answer. */
import { useCallback, useState } from "react";
import { disposePreviewMediaSessions } from "@services/preview-media/session.ts";
import { signOut } from "@api/auth.ts";
import { forgetStoredWorkspace } from "@models/core/active-workspace.ts";

const MEDIA_CLEANUP_MS = 5000;

export interface SignOutState {
	pending: boolean;
	error: string | null;
	leave: () => Promise<void>;
}

export function useSignOut(onSignedOut: () => void): SignOutState {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const leave = useCallback(async () => {
		setPending(true);
		setError(null);
		try {
			await signOut();
			// Private preview files go before the next account; a stuck worker must not trap the user.
			// Orphan reclaim removes whatever outlives the bound.
			await Promise.race([
				disposePreviewMediaSessions(),
				new Promise((resolve) => setTimeout(resolve, MEDIA_CLEANUP_MS)),
			]);
			forgetStoredWorkspace();
			onSignedOut();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not sign out. Try again.");
			setPending(false);
		}
	}, [onSignedOut]);
	return { pending, error, leave };
}
