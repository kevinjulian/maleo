/* Who is signed in, and the way to their own pages and out.
 *
 * Sign-out reports its outcome inside the menu rather than through the app's
 * toast, so the same component works in every shell. A failure keeps the menu
 * open and the session live: showing the sign-in screen over a session that
 * was never revoked would be the wrong answer in the safe-looking direction. */
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Avatar } from "@design-system/components/avatar.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@design-system/components/menu.tsx";
import type { SessionUser } from "@api/auth.ts";
import { useSignOut } from "@hooks/auth/use-sign-out.ts";
import type { AccountSection } from "@models/core/routing.ts";

const ACCOUNT_LINKS: ReadonlyArray<{ section: AccountSection; label: string; icon: JSX.Element }> =
	[
		{ section: "profile", label: "Profile", icon: Ic.user(ICON.md) },
		{ section: "security", label: "Security", icon: Ic.lock(ICON.md) },
		{ section: "preferences", label: "Preferences", icon: Ic.sliders(ICON.md) },
		{ section: "mcp", label: "MCP", icon: Ic.link(ICON.md) },
	];

export function roleLabel(role: string | undefined): string {
	return role === "instance_owner" ? "Instance owner" : "Member";
}

export interface UserMenuProps {
	user: SessionUser;
	onOpenAccount: (section: AccountSection) => void;
	/** After the session is revoked. A full load of /login by default, which
	 *  also discards every in-memory workspace view in one step. */
	onSignedOut?: () => void;
}

export function UserMenu({
	user,
	onOpenAccount,
	onSignedOut = () => window.location.assign("/login"),
}: UserMenuProps): JSX.Element {
	const { pending, error, leave } = useSignOut(onSignedOut);

	return (
		<Menu label={user.email} trigger={<Avatar name={user.name || user.email} />}>
			<MenuLabel>
				<span className="tw:truncate tw:text-sm tw:font-medium">{user.email}</span>
				<span className="tw:text-xs tw:text-muted-foreground">{roleLabel(user.role)}</span>
			</MenuLabel>
			<MenuSeparator />
			{ACCOUNT_LINKS.map(({ section, label, icon }) => (
				<MenuItem key={section} icon={icon} onSelect={() => onOpenAccount(section)}>
					{label}
				</MenuItem>
			))}
			<MenuSeparator />
			<MenuItem
				icon={Ic.logOut(ICON.md)}
				onSelect={() => void leave()}
				closeOnSelect={false}
				disabled={pending}
			>
				{pending ? "Signing out…" : "Sign out"}
			</MenuItem>
			{error && (
				<p role="alert" className="tw:m-0 tw:px-2 tw:py-1.5 tw:text-xs tw:text-destructive">
					{error}
				</p>
			)}
		</Menu>
	);
}
