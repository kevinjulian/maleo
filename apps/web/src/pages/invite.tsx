/* Accepting an invitation.
 *
 * Reached while signed out, so it renders instead of the shell — the same
 * position the sign-in screen occupies, and it borrows that screen's styles for
 * exactly that reason: they are the two surfaces an operator sees before they
 * are anybody.
 *
 * A bad link says so in place. It does not redirect to sign-in, which would
 * replace "this link does not work" with a login form and no explanation of why
 * the thing they were sent did nothing.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";
import { PASSWORD_MIN_LENGTH } from "@maleo/shared";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import { useInvitation } from "@hooks/auth/use-invitation.ts";

export function InvitePage({ token }: { token: string }): JSX.Element {
	const flow = useInvitation(token);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");

	if (flow.state === "loading") {
		return (
			<main className="signin-shell">
				<p className="signin-loading">Checking this invitation…</p>
			</main>
		);
	}

	if (flow.state === "invalid") {
		return (
			<main className="signin-shell">
				<div className="signin-card">
					<h1 className="signin-title">This link does not work</h1>
					{/* Deliberately not specific. Expired, already used, withdrawn and
					    never-existed are one answer, because the difference is only
					    useful to somebody probing the deployment. */}
					<p className="signin-lede">
						It may have expired, already been used, or been withdrawn. Ask whoever invited you for a
						new one.
					</p>
					<Button
						variant="secondary"
						onClick={() => {
							window.location.href = "/";
						}}
					>
						Go to sign in
					</Button>
				</div>
			</main>
		);
	}

	const submit = (event: FormEvent): void => {
		event.preventDefault();
		void flow.accept(flow.signedIn ? undefined : { email, password, name: name || email });
	};

	return (
		<main className="signin-shell">
			<form className="signin-card" onSubmit={submit}>
				<h1 className="signin-title">Join {flow.invitation?.display_name}</h1>
				<p className="signin-lede">
					{flow.signedIn
						? "You are already signed in. Accepting adds this workspace to your account."
						: "Create your account to accept this invitation."}
				</p>

				{!flow.signedIn && (
					<>
						<Field>
							<span className="signin-label">Name</span>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								autoComplete="name"
								placeholder="Your name"
							/>
						</Field>
						<Field>
							<span className="signin-label">Email</span>
							<Input
								type="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								autoComplete="username"
								autoFocus
							/>
						</Field>
						<Field>
							<span className="signin-label">Password</span>
							<Input
								type="password"
								required
								minLength={PASSWORD_MIN_LENGTH}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="new-password"
							/>
							<span className="signin-help">At least {PASSWORD_MIN_LENGTH} characters.</span>
						</Field>
					</>
				)}

				{flow.error && (
					<p className="signin-error" role="alert">
						{flow.error}
					</p>
				)}

				<Button type="submit" variant="primary" disabled={flow.busy}>
					{flow.busy ? "Working…" : flow.signedIn ? "Accept invitation" : "Create account and join"}
				</Button>
			</form>
		</main>
	);
}
