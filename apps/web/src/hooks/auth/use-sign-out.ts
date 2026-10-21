/* Sign-out as state, so the control that offers it only renders the outcome.
 *
 * On success the stored workspace is forgotten before leaving: the next
 * account on this browser must not open in this one's workspace. On failure
 * nothing is left — the session is still live, and saying so is the answer. */
import { useCallback, useState } from "react";
import { signOut } from "@api/auth.ts";
import { forgetStoredWorkspace } from "@models/core/active-workspace.ts";

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
			forgetStoredWorkspace();
			onSignedOut();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not sign out. Try again.");
			setPending(false);
		}
	}, [onSignedOut]);
	return { pending, error, leave };
}
