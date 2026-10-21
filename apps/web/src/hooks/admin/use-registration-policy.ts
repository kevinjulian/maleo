import { useEffect, useState } from "react";
import { getRegistrationPolicy, saveRegistrationPolicy } from "@api/admin.ts";

type Policy = Awaited<ReturnType<typeof getRegistrationPolicy>>["policy"];

export function useRegistrationPolicy() {
	const [policy, setPolicy] = useState<Policy | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let live = true;
		getRegistrationPolicy()
			.then((r) => {
				if (live) setPolicy(r.policy);
			})
			.catch((e: unknown) => {
				if (live) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			live = false;
		};
	}, []);
	const save = async (next: "open" | "invitation_only") => {
		setBusy(true);
		setError(null);
		try {
			await saveRegistrationPolicy(next);
			setPolicy((await getRegistrationPolicy()).policy);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	return { policy, error, busy, save };
}
