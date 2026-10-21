/* The workspace's credit headroom, compact enough for the top bar. The full
 * breakdown the sidebar card used to print is in the title; the pill carries
 * the one number an operator acts on and colours by state. */
import { useEffect, useState, type JSX } from "react";
import {
	fetchCreditSummary,
	formatCreditClock,
	formatCreditPair,
	type CreditSummary,
} from "@api/credits.ts";
import { cn } from "@models/core/cn.ts";

const REFRESH_MS = 30_000;
const LOW_SHARE = 0.8;

type CreditState = "ok" | "low" | "blocked";

export function creditState(summary: CreditSummary): CreditState {
	const dailyLimit = summary.policy.dailyLimitCredits ?? null;
	const rollingLimit = summary.policy.rolling5hLimitCredits ?? null;
	const dailyShare = dailyLimit ? summary.dailyUsedCredits / dailyLimit : 0;
	const rollingShare = rollingLimit ? summary.rolling5hUsedCredits / rollingLimit : 0;
	if (
		summary.enforcementEnabled &&
		((summary.dailyRemainingCredits ?? 1) <= 0 || (summary.rolling5hRemainingCredits ?? 1) <= 0)
	)
		return "blocked";
	return dailyShare >= LOW_SHARE || rollingShare >= LOW_SHARE ? "low" : "ok";
}

const TONE: Record<CreditState, string> = {
	ok: "tw:text-muted-foreground",
	low: "tw:text-warning",
	blocked: "tw:text-destructive",
};

export function CreditPill(): JSX.Element | null {
	const [summary, setSummary] = useState<CreditSummary | null>(null);
	useEffect(() => {
		let alive = true;
		const load = async () => {
			try {
				const next = await fetchCreditSummary();
				if (alive) setSummary(next);
			} catch {
				if (alive) setSummary(null);
			}
		};
		void load();
		const timer = window.setInterval(() => void load(), REFRESH_MS);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, []);
	if (!summary) return null;
	const dailyLimit = summary.policy.dailyLimitCredits ?? null;
	const rollingLimit = summary.policy.rolling5hLimitCredits ?? null;
	const detail = [
		`Credits (${summary.enforcementEnabled ? "enforced" : "observe"})`,
		`Daily left ${formatCreditPair(summary.dailyRemainingCredits, dailyLimit)}`,
		`5h left ${formatCreditPair(summary.rolling5hRemainingCredits, rollingLimit)}`,
		`5h refresh ${formatCreditClock(summary.rolling5hRefreshAt)}`,
	].join("\n");
	return (
		<span
			title={detail}
			className={cn(
				"tw:hidden tw:lg:inline-flex tw:h-8 tw:shrink-0 tw:items-center tw:gap-1 tw:rounded-md tw:border tw:border-border tw:px-2 tw:text-xs",
				TONE[creditState(summary)],
			)}
		>
			<span>Credits</span>
			{formatCreditPair(summary.dailyRemainingCredits, dailyLimit)}
		</span>
	);
}
