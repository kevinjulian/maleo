/* API refusal codes turned into the sentence an operator acts on. The code
 * arrives inside the client's error message; a workspace-scoped refusal carries
 * its workspace after a colon (`last_workspace_owner:alpha`). */
const MESSAGES: ReadonlyArray<[code: string, message: (detail?: string) => string]> = [
	["last_instance_owner", () => "Promote or restore another instance owner first."],
	["suspended_account", () => "Restore this account before making it an instance owner."],
	[
		"last_workspace_owner",
		(ws) =>
			ws
				? `This account is the only owner of ${ws}. Make another member an owner of ${ws} first.`
				: "Transfer workspace ownership first.",
	],
	["last_workspace", () => "The deployment's final workspace cannot be deleted."],
	["deletion_impact_changed", () => "Who loses access changed. Review the impact again."],
	["owner_not_found", () => "No account has that owner email."],
	["workspace_exists", () => "A workspace with that key already exists."],
	["confirmation_mismatch", () => "The confirmation does not match."],
];

export function adminErrorMessage(raw: string): string {
	for (const [code, message] of MESSAGES) {
		const match = new RegExp(`\\b${code}(?::([\\w.-]+))?\\b`).exec(raw);
		if (match) return message(match[1]);
	}
	return raw;
}
