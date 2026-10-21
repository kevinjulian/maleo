import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { PASSWORD_MIN_LENGTH } from "@maleo/shared";
import { Button } from "@design-system/components/button.tsx";
import {
	changePassword,
	listSessions,
	revokeOtherSessions,
	type AccountSession,
} from "@api/auth.ts";
import { describeAgent } from "@models/core/user-agent.ts";
import { AccountGroup, FormOutcome, LabelledInput } from "./account-group.tsx";

const HINT = "tw:text-xs tw:text-muted-foreground";

function PasswordForm({ onChanged }: { onChanged: () => void }): JSX.Element {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
	const mismatch = confirm.length > 0 && confirm !== next;
	const ready =
		current.length > 0 && next.length >= PASSWORD_MIN_LENGTH && confirm === next && !saving;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!ready) return;
		setSaving(true);
		setError(null);
		setDone(null);
		try {
			await changePassword(current, next);
			setCurrent("");
			setNext("");
			setConfirm("");
			setDone("Password changed. Your other sessions were signed out.");
			onChanged();
		} catch (err) {
			// The new-password fields are kept: a wrong current password is the
			// commonest failure, and retyping the new one twice is not its fix.
			setError(err instanceof Error ? err.message : "Could not change your password.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="tw:flex tw:max-w-[24rem] tw:flex-col tw:gap-3"
			onSubmit={(e) => void submit(e)}
		>
			<LabelledInput
				label="Current password"
				type="password"
				value={current}
				onChange={(e) => setCurrent(e.target.value)}
				autoComplete="current-password"
			/>
			<LabelledInput
				label="New password"
				type="password"
				value={next}
				onChange={(e) => setNext(e.target.value)}
				autoComplete="new-password"
				aria-invalid={tooShort}
				hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
			/>
			<LabelledInput
				label="Confirm new password"
				type="password"
				value={confirm}
				onChange={(e) => setConfirm(e.target.value)}
				autoComplete="new-password"
				aria-invalid={mismatch}
				hint={mismatch ? "The passwords do not match." : undefined}
			/>
			<div>
				<Button type="submit" variant="primary" size="sm" disabled={!ready}>
					{saving ? "Changing…" : "Change password"}
				</Button>
			</div>
			<FormOutcome error={error} done={done} />
		</form>
	);
}

function Sessions({ reloadKey }: { reloadKey: number }): JSX.Element {
	const [sessions, setSessions] = useState<AccountSession[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revoking, setRevoking] = useState(false);

	const load = useCallback(async () => {
		try {
			setSessions(await listSessions());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load your sessions.");
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load, reloadKey]);

	const others = (sessions ?? []).filter((s) => !s.current).length;
	const revoke = async () => {
		setRevoking(true);
		try {
			await revokeOtherSessions();
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not sign out your other sessions.");
		} finally {
			setRevoking(false);
		}
	};

	return (
		<AccountGroup
			title="Sessions"
			description="Browsers signed in to this account."
			action={
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={others === 0 || revoking}
					onClick={() => void revoke()}
				>
					{revoking ? "Signing out…" : "Sign out other sessions"}
				</Button>
			}
		>
			<FormOutcome error={error} done={null} />
			{sessions === null && !error && <p className={`tw:m-0 ${HINT}`}>Loading sessions…</p>}
			{sessions && (
				<ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
					{sessions.map((session) => (
						<li
							key={session.id}
							className="tw:flex tw:items-baseline tw:justify-between tw:gap-3 tw:text-sm"
						>
							<span>
								{describeAgent(session.userAgent)}
								{session.current && <span className={`tw:ml-2 ${HINT}`}>This browser</span>}
							</span>
							<span className={HINT}>
								Active {new Date(session.updatedAt).toLocaleDateString()}
							</span>
						</li>
					))}
				</ul>
			)}
		</AccountGroup>
	);
}

export function SecurityPanel(): JSX.Element {
	const [reloadKey, setReloadKey] = useState(0);
	return (
		<>
			<AccountGroup
				title="Password"
				description="Changing your password signs out your other sessions."
			>
				<PasswordForm onChanged={() => setReloadKey((k) => k + 1)} />
			</AccountGroup>
			<Sessions reloadKey={reloadKey} />
		</>
	);
}
