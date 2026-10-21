/* Balance, usage and transactions, loaded together.
 *
 * One request set behind one Refresh: the three views are facets of the same
 * account state, and loading them separately lets the page show a balance from
 * one moment beside usage from another.
 */
import { useCallback, useEffect, useState } from "react";
import {
	fetchCreditSummary,
	fetchCreditTransactions,
	fetchCreditUsage,
	type CreditSummary,
	type CreditTransactionItem,
	type CreditUsageItem,
} from "@api/credits.ts";

const HISTORY_LIMIT = 50;

export interface CreditConsoleModel {
	summary: CreditSummary | null;
	usage: CreditUsageItem[];
	transactions: CreditTransactionItem[];
	busy: boolean;
	error: string | null;
	dailyLimit: number | null;
	rollingLimit: number | null;
	perRunLimit: number | null;
	approvalLimit: number | null;
	dailyPct: number;
	rollingPct: number;
	reload: () => Promise<void>;
}

export function useCreditConsole(): CreditConsoleModel {
	const [summary, setSummary] = useState<CreditSummary | null>(null);
	const [usage, setUsage] = useState<CreditUsageItem[]>([]);
	const [transactions, setTransactions] = useState<CreditTransactionItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			const [nextSummary, nextUsage, nextTransactions] = await Promise.all([
				fetchCreditSummary(),
				fetchCreditUsage(HISTORY_LIMIT),
				fetchCreditTransactions(HISTORY_LIMIT),
			]);
			setSummary(nextSummary);
			setUsage(nextUsage);
			setTransactions(nextTransactions);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const dailyLimit = summary?.policy.dailyLimitCredits ?? null;
	const rollingLimit = summary?.policy.rolling5hLimitCredits ?? null;

	return {
		summary,
		usage,
		transactions,
		busy,
		error,
		dailyLimit,
		rollingLimit,
		perRunLimit: summary?.policy.perRunLimitCredits ?? null,
		approvalLimit: summary?.policy.requireApprovalAboveCredits ?? null,
		dailyPct:
			summary && dailyLimit
				? Math.min(100, Math.round((summary.dailyUsedCredits / dailyLimit) * 100))
				: 0,
		rollingPct:
			summary && rollingLimit
				? Math.min(100, Math.round((summary.rolling5hUsedCredits / rollingLimit) * 100))
				: 0,
		reload,
	};
}
