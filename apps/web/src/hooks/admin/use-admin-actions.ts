import { useState } from "react";
import * as api from "@api/admin.ts";
import { adminErrorMessage } from "@models/admin/admin-errors.ts";

export function useAdminActions(onDone: () => void) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = async <T>(work: () => Promise<T>): Promise<T | null> => {
		setBusy(true);
		setError(null);
		try {
			const result = await work();
			onDone();
			return result;
		} catch (e) {
			setError(adminErrorMessage(e instanceof Error ? e.message : String(e)));
			return null;
		} finally {
			setBusy(false);
		}
	};
	return { api, run, busy, error, clearError: () => setError(null) };
}
