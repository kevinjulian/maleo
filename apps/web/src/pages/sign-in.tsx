/* The one screen an operator sees before they are anybody.
 *
 * It is two screens wearing one form, and which one it is comes from the
 * deployment rather than from a route: a database with no accounts asks for a
 * name and creates the owner, and a database with accounts asks for a
 * credential. That distinction is why this cannot be a static page — offering
 * "create an account" on a claimed deployment produces a refusal the operator
 * cannot act on, and offering sign-in on an unclaimed one asks for a password
 * that does not exist yet.
 *
 * The page composes; `useSignIn` decides. See hooks/auth/use-sign-in.ts.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";
import { PASSWORD_MIN_LENGTH } from "@maleo/shared";
import { Button } from "@design-system/components/button.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import { useSignIn } from "@hooks/auth/use-sign-in.ts";

export function SignInPage(): JSX.Element {
	const { mode, error, busy, submit } = useSignIn();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");

	if (mode === "loading") {
		return (
			<main className="signin-shell">
				<p className="signin-loading">Checking this deployment…</p>
			</main>
		);
	}

	const first = mode === "first-run";
	const onSubmit = (event: FormEvent): void => {
		event.preventDefault();
		void submit({ email, password, name });
	};

	return (
		<main className="signin-shell">
			<form className="signin-card" onSubmit={onSubmit}>
				<div className="tw:mb-4 tw:flex tw:items-center tw:gap-2 tw:font-semibold">
					<img src="/maleo-icon-192.png" alt="" className="tw:size-8 tw:rounded-sm" />
					<span>Maleo</span>
				</div>
				<h1 className="signin-title">{first ? "Claim this deployment" : "Sign in"}</h1>
				<p className="signin-lede">
					{first
						? "No account exists yet. The first one you create owns this instance."
						: "This instance is private."}
				</p>

				{first && (
					<Field>
						<span className="signin-label">Name</span>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							autoComplete="name"
							placeholder="Your name"
						/>
					</Field>
				)}

				<Field>
					<span className="signin-label">Email</span>
					<Input
						type="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="username"
						autoFocus={!first}
					/>
				</Field>

				<Field>
					<span className="signin-label">Password</span>
					<Input
						type="password"
						required
						// Matches the API's minimum, so a too-short password is refused in
						// the browser rather than after a round trip.
						minLength={PASSWORD_MIN_LENGTH}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete={first ? "new-password" : "current-password"}
					/>
					{first && <span className="signin-help">At least {PASSWORD_MIN_LENGTH} characters.</span>}
				</Field>

				{/* role=alert so a refusal is announced, not only drawn. */}
				{error && (
					<p className="signin-error" role="alert">
						{error}
					</p>
				)}

				<Button type="submit" variant="primary" disabled={busy}>
					{busy ? "Working…" : first ? "Create owner account" : "Sign in"}
				</Button>
			</form>
		</main>
	);
}
