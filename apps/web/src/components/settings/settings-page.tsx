/* The settings surface: usage, capabilities and their providers, security.
 *
 *   Settings                                    (shared Page + PageHeader)
 *   [Usage] [Capabilities] [Security & Privacy]
 *   ──────────────────────────────────────────  the tab row's own baseline
 *   [tab content]
 *
 * Sections are TABS, so the three fixed destinations cost a row rather than a
 * column, and the columns below them are all content. A left column spent 200px
 * on destinations that never change and left a 316px detail pane at 1024px — too
 * narrow for a URL field and its buttons.
 *
 * The frame is the shared `Page` + `PageHeader` every other top-level surface
 * uses — same centred measure, same title. Settings was the one page with a
 * heading idiom of its own, which is the thing `page-chrome` exists to prevent.
 *
 * Every level is a route: `/settings/capabilities/tts/kokoro` addresses one
 * provider's setup. Nothing lives in component tab state — a level that is not a
 * route cannot be linked, cannot be reached by the back button, and cannot be
 * photographed without a synthetic click, which is how a settings tab went
 * uncovered while 297 green snapshots reported success.
 *
 * This file composes tabs and owns nothing else; each tab owns its own columns.
 */
import type { JSX } from "react";
import { useCreditConsole } from "@hooks/settings/use-credit-console.ts";
import { useGlobalKeys } from "@hooks/settings/use-global-keys.ts";
import { useCapabilities } from "@hooks/settings/use-capabilities.ts";
import { useSettingsColumns } from "@hooks/settings/use-settings-columns.ts";
import { CreditsPanel } from "@components/settings/credits-panel.tsx";
import { SecurityPanel } from "@components/settings/security-panel.tsx";
import { CapabilitiesTab } from "@components/settings/capabilities-tab.tsx";
import { DEFAULT_SECURITY_TOPIC, toSecurityTopic } from "@components/settings/security-topics.ts";
import { Page, PageHeader } from "@design-system/components/page.tsx";
import { SETTINGS_SECTIONS, type SettingsSection } from "@models/core/routing.ts";
import "@components/settings/settings.css";
import { Note } from "@design-system/components/note.tsx";

const SECTION_LABEL = {
	usage: "Usage",
	capabilities: "Capabilities",
	security: "Security & Privacy",
} satisfies Record<SettingsSection, string>;

export interface SettingsPageProps {
	embedded?: boolean;
	section?: SettingsSection;
	detail?: string;
	provider?: string;
	onNavigate: (next: { section?: SettingsSection; detail?: string; provider?: string }) => void;
}

export function SettingsPage({
	embedded = false,
	section,
	detail,
	provider,
	onNavigate,
}: SettingsPageProps): JSX.Element {
	const credits = useCreditConsole();
	const keys = useGlobalKeys();
	const capabilities = useCapabilities();

	/* Side by side, a column with nothing chosen is an empty pane beside two full
	 * ones, so the first item opens. One at a time, a chosen item IS the screen,
	 * so choosing one by default would skip the list the operator came to read.
	 * Selection only — the address is never rewritten. */
	const wide = useSettingsColumns();

	/* `/settings` with no section lands on Capabilities: it is what this surface
	 * exists for, and with the tabs always visible an index screen would show
	 * nothing the tab row is not already showing. */
	const active: SettingsSection = section ?? "capabilities";
	const error = capabilities.error ?? keys.error;

	return (
		<Page>
			{!embedded && (
				<PageHeader title="Settings" lead="Providers, usage and where credentials are kept." />
			)}

			{!embedded && (
				<nav className="settings-tabs" aria-label="Settings sections">
					{SETTINGS_SECTIONS.map((id) => (
						<button
							type="button"
							key={id}
							className={`settings-tab${active === id ? " active" : ""}`}
							aria-current={active === id ? "page" : undefined}
							onClick={() => onNavigate({ section: id })}
						>
							{SECTION_LABEL[id]}
						</button>
					))}
				</nav>
			)}

			{error && (
				<Note tone="error" role="alert">
					{error}
				</Note>
			)}

			{active === "usage" && (
				<CreditsPanel
					credits={credits}
					section={detail}
					onSection={(s) => onNavigate({ section: "usage", detail: s })}
				/>
			)}

			{active === "security" && (
				<SecurityPanel
					keys={keys}
					topic={toSecurityTopic(detail) ?? (wide ? DEFAULT_SECURITY_TOPIC : null)}
					onTopic={(next) => onNavigate({ section: "security", detail: next })}
					onBack={() => onNavigate({ section: "security" })}
				/>
			)}

			{active === "capabilities" && (
				<CapabilitiesTab
					capabilities={capabilities}
					detail={detail}
					provider={provider}
					wide={wide}
					onNavigate={(next) => onNavigate({ section: "capabilities", ...next })}
				/>
			)}
		</Page>
	);
}
