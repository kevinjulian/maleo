import { useEffect, useState } from "react";
import { getAudit, type AdminAudit, type Page } from "@api/admin.ts";

export function useAdminAudit(offset: number) {
	const [page, setPage] = useState<Page<AdminAudit> | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		getAudit(offset)
			.then((next) => {
				if (live) setPage(next);
			})
			.catch((e: unknown) => {
				if (live) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			live = false;
		};
	}, [offset]);
	return { page, error };
}
