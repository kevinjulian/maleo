/* Accepting an invitation.
 *
 * Two shapes on one screen, decided by whether somebody is already signed in:
 * an existing operator joins with one click, and a new one supplies a password
 * first. Asking a signed-in operator for a password would create a second
 * account for a person who already has one.
 */
import { useCallback, useEffect, useState } from "react";
import {
	readInvitation,
	readSession,
	redeemInvitation,
	type InvitationPreview,
} from "@api/auth.ts";

export interface InvitationFlow {
	state: "loading" | "invalid" | "ready";
	invitation: InvitationPreview | null;
	/** True when an account is already signed in — no password needed. */
	signedIn: boolean;
	error: string | null;
	busy: boolean;
	accept: (credentials?: { email: string; password: string; name?: string }) => Promise<void>;
}

export function useInvitation(token: string): InvitationFlow {
	const [state, setState] = useState<InvitationFlow["state"]>("loading");
	const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
	const [signedIn, setSignedIn] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		Promise.all([readInvitation(token), readSession()])
			.then(([found, session]) => {
				if (!live) return;
				setSignedIn(session !== null);
				setInvitation(found);
				setState(found ? "ready" : "invalid");
			})
			.catch(() => {
				// An unreachable API is not a bad invitation, but the screen can only
				// offer one thing either way: try the link again later.
				if (live) setState("invalid");
			});
		return () => {
			live = false;
		};
	}, [token]);

	const accept = useCallback(
		async (credentials?: { email: string; password: string; name?: string }) => {
			setError(null);
			setBusy(true);
			try {
				await redeemInvitation(token, credentials);
				// A reload, not a state swap: everything the app cached was fetched
				// for whoever was here before this membership existed.
				window.location.href = "/";
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong.");
				setBusy(false);
			}
		},
		[token],
	);

	return { state, invitation, signedIn, error, busy, accept };
}
