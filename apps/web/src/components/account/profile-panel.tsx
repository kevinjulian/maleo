import { useState, type FormEvent, type JSX } from "react";
import { Button } from "@design-system/components/button.tsx";
import { updateName, type SessionUser } from "@api/auth.ts";
import { AccountGroup, FormOutcome, LabelledInput } from "./account-group.tsx";

/** The signed-in account as the account pages see it. */
export type AccountUser = SessionUser;

export function ProfilePanel({
	user,
	onUserChange,
}: {
	user: SessionUser;
	onUserChange: (next: SessionUser) => void;
}): JSX.Element {
	const [name, setName] = useState(user.name);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const blank = name.trim().length === 0;
	const unchanged = name.trim() === user.name;

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (blank) return;
		setSaving(true);
		setError(null);
		setDone(null);
		try {
			await updateName(name);
			onUserChange({ ...user, name: name.trim() });
			setDone("Saved.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save your name.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<AccountGroup
				title="Email"
				description="The address you sign in with. It cannot be changed here."
			>
				<p className="tw:m-0 tw:text-sm">{user.email}</p>
			</AccountGroup>
			<AccountGroup title="Name" description="How you appear to the people you work with.">
				<form
					className="tw:flex tw:max-w-[24rem] tw:flex-col tw:gap-3"
					onSubmit={(e) => void save(e)}
				>
					<LabelledInput
						label="Display name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						aria-invalid={blank}
						autoComplete="name"
						hint={blank ? "A name cannot be empty." : undefined}
					/>
					<div>
						<Button
							type="submit"
							variant="primary"
							size="sm"
							disabled={blank || unchanged || saving}
						>
							{saving ? "Saving…" : "Save"}
						</Button>
					</div>
					<FormOutcome error={error} done={done} />
				</form>
			</AccountGroup>
		</>
	);
}
