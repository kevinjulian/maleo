import type { CreditLimitPolicy } from "@maleo/shared";
import { get } from "@api/client.ts";

export interface CreditSummary {
	account: {
		available_credits: number;
		reserved_credits: number;
	};
	policy: CreditLimitPolicy;
	dailyUsedCredits: number;
	rolling5hUsedCredits: number;
	dailyRemainingCredits: number | null;
	rolling5hRemainingCredits: number | null;
	dailyRefreshAt: string;
	rolling5hRefreshAt: string | null;
	enforcementEnabled: boolean;
}

export interface CreditUsageItem {
	id: string;
	operation: string;
	provider?: string | null;
	model?: string | null;
	quantity: number;
	unit: string;
	charged_credits: number;
	created_at: number;
}

export interface CreditTransactionItem {
	id: string;
	type: string;
	amount_credits: number;
	balance_available_after: number;
	balance_reserved_after: number;
	reference_type?: string | null;
	description?: string | null;
	created_at: number;
}

export async function fetchCreditSummary(): Promise<CreditSummary> {
	return get<CreditSummary>("/api/credits/balance");
}

export async function fetchCreditUsage(limit = 50): Promise<CreditUsageItem[]> {
	const body = await get<{ items?: CreditUsageItem[] }>(
		`/api/credits/usage?limit=${encodeURIComponent(String(limit))}`,
	);
	return body.items ?? [];
}

export async function fetchCreditTransactions(limit = 50): Promise<CreditTransactionItem[]> {
	const body = await get<{ items?: CreditTransactionItem[] }>(
		`/api/credits/transactions?limit=${encodeURIComponent(String(limit))}`,
	);
	return body.items ?? [];
}

export function formatCredits(value: number | null | undefined): string {
	if (value == null) return "No limit";
	return Math.max(0, Math.floor(value)).toLocaleString();
}

export function formatCreditPair(
	left: number | null | undefined,
	limit: number | null | undefined,
): string {
	if (limit == null) return `${formatCredits(left)} left`;
	return `${formatCredits(left)} / ${formatCredits(limit)}`;
}

export function formatCreditClock(iso: string | null | undefined): string {
	if (!iso) return "now";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "now";
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatCreditDate(value: number | string | null | undefined): string {
	if (value == null) return "-";
	const d = new Date(typeof value === "number" ? value : String(value));
	if (Number.isNaN(d.getTime())) return "-";
	return d.toLocaleString([], {
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}
