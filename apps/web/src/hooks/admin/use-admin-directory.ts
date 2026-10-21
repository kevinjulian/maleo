import { useEffect, useState } from "react";
import {
	getDetail,
	listDirectory,
	type Directory,
	type DirectoryItem,
	type Page,
} from "@api/admin.ts";

export function useAdminDirectory<T extends DirectoryItem>(
	kind: Directory,
	q: string,
	offset: number,
	id?: string,
) {
	const [page, setPage] = useState<Page<T> | null>(null);
	const [detail, setDetail] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError(null);
		Promise.all([
			listDirectory<T>(kind, q, offset),
			id ? getDetail<T>(kind, id) : Promise.resolve(null),
		])
			.then(([nextPage, nextDetail]) => {
				if (!alive) return;
				setPage(nextPage);
				setDetail(nextDetail?.item ?? null);
			})
			.catch((e: unknown) => {
				if (alive) setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [kind, q, offset, id, revision]);
	return { page, detail, loading, error, refresh: () => setRevision((n) => n + 1) };
}
