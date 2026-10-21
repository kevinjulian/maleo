/* The sign-in screen's state machine, kept out of the page.
 *
 * Which of the two screens to show is a question only the API can answer, so it
 * is a fetch, and a page does not fetch. What the page gets back is a mode and
 * a submit — no request shapes, no status codes.
 */
import { useCallback, useEffect, useState } from "react";
import { createFirstOwner, readAuthState, signIn } from "@api/auth.ts";

export type SignInMode = "loading" | "sign-in" | "first-run";

export interface SignInForm {
	mode: SignInMode;
	error: string | null;
	busy: boolean;
	submit: (input: { email: string; password: string; name: string }) => Promise<void>;
}

/** Where to land after a successful sign-in. Only same-site paths are honoured:
 *  `?next=` is attacker-supplied, and an absolute URL here would make the
 *  sign-in screen an open redirect. */
function destination(): string {
	const next = new URLSearchParams(window.location.search).get("next");
	return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function useSignIn(): SignInForm {
	const [mode, setMode] = useState<SignInMode>("loading");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		readAuthState()
			.then((state) => {
				if (live) setMode(state.hasAccounts ? "sign-in" : "first-run");
			})
			// An unreachable API is not an unclaimed deployment. Falling back to
			// sign-in asks for a credential rather than offering to create an owner
			// on a database we could not read.
			.catch(() => {
				if (live) setMode("sign-in");
			});
		return () => {
			live = false;
		};
	}, []);

	const submit = useCallback(
		async ({ email, password, name }: { email: string; password: string; name: string }) => {
			setError(null);
			setBusy(true);
			try {
				if (mode === "first-run") await createFirstOwner(email, password, name || email);
				else await signIn(email, password);
				/* A reload, not a state swap. Every store and cached fetch was
				 * populated for an anonymous caller; discarding all of it is exactly
				 * what a navigation does and exactly what re-rendering does not. */
				window.location.href = destination();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong.");
				setBusy(false);
			}
		},
		[mode],
	);

	return { mode, error, busy, submit };
}
