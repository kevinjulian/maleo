import type { JSX } from "react";
import { PageHeader } from "@design-system/components/page.tsx";
import { ProfilePanel, type AccountUser } from "@components/account/profile-panel.tsx";
import { SecurityPanel } from "@components/account/security-panel.tsx";
import { PreferencesPanel } from "@components/account/preferences-panel.tsx";
import { McpPanel } from "@components/account/mcp-panel.tsx";
import type { AccountSection } from "@models/core/routing.ts";

export const ACCOUNT_TITLE: Record<AccountSection, string> = {
	profile: "Profile",
	security: "Security",
	preferences: "Preferences",
	mcp: "MCP",
};

export function AccountPage({
	section,
	user,
	onUserChange,
}: {
	section: AccountSection;
	user: AccountUser;
	onUserChange: (next: AccountUser) => void;
}): JSX.Element {
	const lead = {
		profile: `Who you are on this instance.`,
		security: `How you sign in to ${user.email}.`,
		preferences: "How the app looks for you.",
		mcp: "Connect Codex CLI, Claude Code or another MCP client to your projects.",
	} satisfies Record<AccountSection, string>;
	return (
		<>
			<PageHeader title={ACCOUNT_TITLE[section]} lead={lead[section]} />
			{section === "profile" && <ProfilePanel user={user} onUserChange={onUserChange} />}
			{section === "security" && <SecurityPanel />}
			{section === "preferences" && <PreferencesPanel />}
			{section === "mcp" && <McpPanel />}
		</>
	);
}
