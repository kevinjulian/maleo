/* Decides whether the app renders at all.
 *
 * This exists because of a loop, not for tidiness. The fetch boundary sends a
 * 401 to `/login`; `/login` serves the same index.html as every other path;
 * index.html mounts the app; the app fetches; the fetch answers 401. Without a
 * gate in front of the mount, an expired session is a page that reloads
 * forever and never shows a form.
 *
 * So the session is resolved ONCE, before anything else mounts, and the app is
 * only constructed when there is somebody to construct it for. That ordering is
 * also why the shell never has to consider the anonymous case: by the time it
 * renders, there is a session.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { App } from "./app.tsx";
import { SignInPage } from "@pages/sign-in.tsx";
import { InvitePage } from "@pages/invite.tsx";
import { readSession, type SessionUser } from "@api/auth.ts";

type Gate = { state: "checking" } | { state: "in"; user: SessionUser } | { state: "out" };

export function AuthGate(): JSX.Element | null {
	const [gate, setGate] = useState<Gate>({ state: "checking" });

	useEffect(() => {
		let live = true;
		readSession()
			.then((user) => {
				if (!live) return;
				setGate(user ? { state: "in", user } : { state: "out" });
			})
			// An unreachable API is treated as signed out. The alternative is
			// mounting the app against an API that cannot answer, which renders a
			// shell full of failed requests instead of one honest screen.
			.catch(() => live && setGate({ state: "out" }));
		return () => {
			live = false;
		};
	}, []);

	/* An invitation link is answered before the session is, because it is the one
	 * address that means something to a signed-out caller AND to a signed-in one:
	 * a new person creates an account here, and an existing operator adds the
	 * workspace to the account they already have. Routing it through the gate
	 * would send the first to sign-in and the second straight past it. */
	const invite = /^\/invite\/(.+)$/.exec(window.location.pathname);
	if (invite?.[1]) return <InvitePage token={decodeURIComponent(invite[1])} />;

	/* Nothing, not a spinner. The check is one local request; a flash of
	 * chrome that then vanishes reads as a bug, and a spinner for 20ms reads as
	 * slowness the app does not have. */
	if (gate.state === "checking") return null;
	if (gate.state === "out") return <SignInPage />;
	return <App user={gate.user} />;
}
