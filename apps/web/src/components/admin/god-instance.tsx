import { Select } from "@design-system/components/select.tsx";
import { useEffect, useState, type JSX } from "react";
import type { GodSection } from "@models/core/routing.ts";
import { listDirectory } from "@api/admin.ts";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { SettingsPage } from "@components/settings/settings-page.tsx";
import { useAdminAudit } from "@hooks/admin/use-admin-audit.ts";
import { useRegistrationPolicy } from "@hooks/admin/use-registration-policy.ts";
import { GodPager } from "./god-pager.tsx";

type Navigate = (section: GodSection, detail?: string, provider?: string) => void;

const SETTINGS_TITLES = {
	providers: "Providers",
	security: "Security & Storage",
	usage: "Usage",
} as const;

export function GodInstance({
	section,
	detail,
	provider,
	navigate,
}: {
	section: GodSection;
	detail?: string;
	provider?: string;
	navigate: Navigate;
}): JSX.Element {
	if (section === "general") return <Overview navigate={navigate} />;
	if (section === "authentication") return <Authentication />;
	if (section === "audit") return <Audit />;
	const godSection = section === "security" || section === "usage" ? section : "providers";
	return (
		<div className="god-settings">
			<div className="god-section-heading">
				<div>
					<p className="god-eyebrow">Instance</p>
					<h1>{SETTINGS_TITLES[godSection]}</h1>
				</div>
			</div>
			<SettingsPage
				embedded
				section={godSection === "providers" ? "capabilities" : godSection}
				detail={detail}
				provider={provider}
				onNavigate={(next) =>
					navigate(
						next.section === "capabilities" || !next.section ? "providers" : next.section,
						next.detail,
						next.provider,
					)
				}
			/>
		</div>
	);
}

function OverviewLink({
	label,
	count,
	onClick,
}: {
	label: string;
	count?: number | string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button type="button" onClick={onClick}>
			{label}
			<span>
				{count ?? null} {Ic.chevR(ICON.md)}
			</span>
		</button>
	);
}

function Overview({ navigate }: { navigate: Navigate }): JSX.Element {
	const [counts, setCounts] = useState<number[] | null>(null);
	const [error, setError] = useState(false);
	useEffect(() => {
		let live = true;
		Promise.all(
			(["users", "workspaces", "projects"] as const).map((kind) => listDirectory(kind, "", 0)),
		)
			.then((pages) => {
				if (live) setCounts(pages.map((page) => page.total));
			})
			.catch(() => {
				if (live) setError(true);
			});
		return () => {
			live = false;
		};
	}, []);
	return (
		<div className="god-content">
			<p className="god-eyebrow">Instance</p>
			<h1>Overview</h1>
			<p className="god-lead">Deployment accounts, workspaces, projects, and controls.</p>
			{error && (
				<p className="god-error" role="alert">
					Could not load instance summary.
				</p>
			)}
			<div className="god-overview">
				<OverviewLink label="Users" count={counts?.[0] ?? "—"} onClick={() => navigate("users")} />
				<OverviewLink
					label="Workspaces"
					count={counts?.[1] ?? "—"}
					onClick={() => navigate("workspaces")}
				/>
				<OverviewLink
					label="Projects"
					count={counts?.[2] ?? "—"}
					onClick={() => navigate("projects")}
				/>
				<OverviewLink label="Registration policy" onClick={() => navigate("authentication")} />
				<OverviewLink label="Provider settings" onClick={() => navigate("providers")} />
			</div>
		</div>
	);
}

function Authentication(): JSX.Element {
	const { policy, error, busy, save } = useRegistrationPolicy();
	return (
		<div className="god-content">
			<p className="god-eyebrow">Instance</p>
			<h1>Authentication</h1>
			<p className="god-lead">Choose how new accounts join this deployment.</p>
			<section className="god-action-section">
				<h3>Self-registration</h3>
				{policy ? (
					<>
						<div className="god-fields">
							<div>
								<span>Effective policy</span>
								<strong>{policy.effective === "open" ? "Open" : "Invitation only"}</strong>
							</div>
							<div>
								<span>Source</span>
								<strong>
									{policy.source === "environment" ? "MALEO_ALLOW_SIGNUP" : "Stored setting"}
								</strong>
							</div>
						</div>
						<p className="god-muted">
							Invitations still work when self-registration is invitation only. First account can
							always claim an empty deployment.
						</p>
						<Select
							aria-label="Registration policy"
							disabled={busy || policy.source === "environment"}
							value={policy.stored}
							onValueChange={(event) => void save(event === "open" ? "open" : "invitation_only")}
							options={[
								{ value: "invitation_only", label: "Invitation only" },
								{ value: "open", label: "Open" },
							]}
						/>
						{policy.source === "environment" && (
							<p className="god-muted">
								Environment override is active. Change MALEO_ALLOW_SIGNUP on deployment to edit
								here.
							</p>
						)}
					</>
				) : (
					<p className="god-muted">Loading policy…</p>
				)}
				{error && (
					<p className="god-error" role="alert">
						{error}
					</p>
				)}
			</section>
		</div>
	);
}

function Audit(): JSX.Element {
	const [offset, setOffset] = useState(0);
	const { page, error } = useAdminAudit(offset);
	return (
		<div className="god-content">
			<p className="god-eyebrow">Instance</p>
			<h1>Audit log</h1>
			<p className="god-lead">Recent administrative changes and refusals.</p>
			{error && (
				<p className="god-error" role="alert">
					{error}
				</p>
			)}
			{!page && !error && <p className="god-muted">Loading audit…</p>}
			{page?.items.length === 0 && <p className="god-empty">No admin actions recorded yet.</p>}
			<div className="god-audit-list">
				{page?.items.map((row) => (
					<div key={row.id}>
						<span className={`god-outcome ${row.outcome}`}>{row.outcome}</span>
						<strong>{row.action}</strong>
						<span>
							{row.target_type} · {row.target_id}
						</span>
						<time>{new Date(row.created_at).toLocaleString()}</time>
						{row.reason && <small>{row.reason}</small>}
					</div>
				))}
			</div>
			{page && <GodPager offset={offset} total={page.total} onOffset={setOffset} />}
		</div>
	);
}
