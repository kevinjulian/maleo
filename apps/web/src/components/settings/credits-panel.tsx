import { Table } from "@design-system/components/table.tsx";
/* Usage: balance, activity, transactions and the policy in force.
 *
 * The sub-view is a ROUTE, not local state — promoted out of the tab strip that
 * used to live here so the surface has one navigation idiom rather than a tab
 * strip nested inside a nav pane. `/settings/usage/activity` is linkable and
 * photographable for the same reason every other level is.
 *
 * The `usage` tab became "Activity": promoting it as-is produced `Usage › Usage`,
 * and a child that repeats its parent tells the reader the level means nothing.
 * Activity is what it renders — a time-ordered log of charges by operation,
 * provider and model. */

import type { JSX } from "react";
import {
	formatCreditClock,
	formatCreditDate,
	formatCreditPair,
	formatCredits,
} from "@api/credits.ts";
import type { CreditConsoleModel } from "@hooks/settings/use-credit-console.ts";
import type { CreditTab } from "@models/settings/status-views.ts";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";

/* The tab strip's members, declared once with the element type rather than
 * asserted on the array. A misspelled tab now fails to compile instead of
 * narrowing to a `CreditTab` it is not. */
const CREDIT_TABS: readonly CreditTab[] = ["balance", "usage", "transactions", "policy"];

/** Route segment per sub-view. Only `usage` differs, and it differs on purpose. */
const SEGMENT_LABEL: Record<CreditTab, string> = {
	balance: "Balance",
	usage: "Activity",
	transactions: "Transactions",
	policy: "Policy",
};

const SEGMENT_FOR: Record<string, CreditTab> = {
	balance: "balance",
	activity: "usage",
	transactions: "transactions",
	policy: "policy",
};

const PATH_FOR: Record<CreditTab, string> = {
	balance: "balance",
	usage: "activity",
	transactions: "transactions",
	policy: "policy",
};

export function CreditsPanel({
	credits,
	section,
	onSection,
}: {
	credits: CreditConsoleModel;
	/** Route segment. Absent means the default sub-view. */
	section?: string;
	onSection: (segment: string) => void;
}): JSX.Element {
	const tab: CreditTab = (section ? SEGMENT_FOR[section] : undefined) ?? "balance";
	const setTab = (next: CreditTab): void => onSection(PATH_FOR[next]);
	const { summary, usage, transactions, busy, error } = credits;

	return (
		<section className="settings-card credits-page">
			<div className="settings-card-head">
				<div>
					<h2>Usage</h2>
					<p>Operator visibility and generation guardrails.</p>
				</div>
				<Button size="sm" onClick={() => void credits.reload()} loading={busy}>
					Refresh
				</Button>
			</div>
			{error && (
				<Note tone="error" role="alert">
					{error}
				</Note>
			)}
			{/* Navigation, not tabs: each section is an address (/usage/activity), so
			    Back and a shared link land on it. The current one says so. */}
			<nav className="seg credits-tabs" aria-label="Usage sections">
				{CREDIT_TABS.map((name) => (
					<button
						key={name}
						type="button"
						className={tab === name ? "active" : ""}
						aria-current={tab === name ? "page" : undefined}
						onClick={() => setTab(name)}
					>
						{SEGMENT_LABEL[name]}
					</button>
				))}
			</nav>

			{tab === "balance" && (
				<div className="credits-balance-grid">
					<div className="credits-metric">
						<span>Daily left</span>
						<b>{formatCreditPair(summary?.dailyRemainingCredits, credits.dailyLimit)}</b>
						<em>refresh {formatCreditClock(summary?.dailyRefreshAt)}</em>
						<div className="credits-bar">
							<i style={{ width: `${credits.dailyPct}%` }} />
						</div>
					</div>
					<div className="credits-metric">
						<span>5h left</span>
						<b>{formatCreditPair(summary?.rolling5hRemainingCredits, credits.rollingLimit)}</b>
						<em>refresh {formatCreditClock(summary?.rolling5hRefreshAt)}</em>
						<div className="credits-bar">
							<i style={{ width: `${credits.rollingPct}%` }} />
						</div>
					</div>
					<div className="credits-metric">
						<span>Available</span>
						<b>{formatCredits(summary?.account.available_credits)}</b>
						<em>reserved {formatCredits(summary?.account.reserved_credits)}</em>
					</div>
				</div>
			)}

			{tab === "usage" && (
				<div
					className="credits-table-scroll"
					role="region"
					aria-label="Usage activity"
					tabIndex={0}
				>
					<Table className="credits-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>Type</th>
								<th>Tool</th>
								<th>Credits</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{usage.length === 0 && (
								<tr>
									<td colSpan={5} className="muted">
										No usage yet.
									</td>
								</tr>
							)}
							{usage.map((item) => (
								<tr key={item.id}>
									<td>{formatCreditDate(item.created_at)}</td>
									<td>{item.operation}</td>
									<td>{[item.provider, item.model].filter(Boolean).join(" / ") || item.unit}</td>
									<td className="credits-negative">-{formatCredits(item.charged_credits)}</td>
									<td>charged</td>
								</tr>
							))}
						</tbody>
					</Table>
				</div>
			)}

			{tab === "transactions" && (
				<div className="credits-table-scroll" role="region" aria-label="Transactions" tabIndex={0}>
					<Table className="credits-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>Type</th>
								<th>Description</th>
								<th>Credits</th>
								<th>Balance</th>
							</tr>
						</thead>
						<tbody>
							{transactions.length === 0 && (
								<tr>
									<td colSpan={5} className="muted">
										No transactions yet.
									</td>
								</tr>
							)}
							{transactions.map((item) => (
								<tr key={item.id}>
									<td>{formatCreditDate(item.created_at)}</td>
									<td>{item.type}</td>
									<td>{item.description || item.reference_type || "-"}</td>
									<td className={item.amount_credits < 0 ? "credits-negative" : "credits-positive"}>
										{item.amount_credits > 0 ? "+" : item.amount_credits < 0 ? "-" : ""}
										{formatCredits(Math.abs(item.amount_credits))}
									</td>
									<td>{formatCredits(item.balance_available_after)}</td>
								</tr>
							))}
						</tbody>
					</Table>
				</div>
			)}

			{tab === "policy" && (
				<div className="credits-policy">
					<span>Daily limit</span>
					<b>{formatCredits(credits.dailyLimit)}</b>
					<span>Rolling 5h limit</span>
					<b>{formatCredits(credits.rollingLimit)}</b>
					<span>Per-run limit</span>
					<b>{formatCredits(credits.perRunLimit)}</b>
					<span>Require approval &gt;</span>
					<b>{formatCredits(credits.approvalLimit)}</b>
					<span>Enforcement</span>
					<b>{summary?.enforcementEnabled ? "Enforce" : "Observe"}</b>
				</div>
			)}
		</section>
	);
}
