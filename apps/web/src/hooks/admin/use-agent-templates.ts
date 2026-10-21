import { useCallback, useEffect, useState } from "react";
import { ZodError } from "zod";
import type { AgentTemplateCatalog } from "@maleo/shared";
import { getAgentTemplates } from "@api/admin.ts";
import { ApiError } from "@api/client.ts";

export function useAgentTemplates() {
	const [catalog, setCatalog] = useState<AgentTemplateCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [denied, setDenied] = useState(false);
	const [generation, setGeneration] = useState(0);
	const reload = useCallback(() => {
		setCatalog(null);
		setError(null);
		setGeneration((value) => value + 1);
	}, []);
	useEffect(() => {
		let live = true;
		setDenied(false);
		getAgentTemplates()
			.then((next) => {
				if (live) setCatalog(next);
			})
			.catch((cause: unknown) => {
				if (!live) return;
				setCatalog(null);
				setDenied(cause instanceof ApiError && (cause.status === 401 || cause.status === 403));
				setError(
					cause instanceof ZodError
						? cause.issues.some((issue) => issue.path[0] === "schemaVersion")
							? "This web client requires catalog schema 2. Deploy matching API and web, then reload. Definitions cleared."
							: "Deployed template definitions are invalid. Definitions cleared."
						: "Could not load definitions.",
				);
			});
		return () => {
			live = false;
		};
	}, [generation]);
	return { catalog, error, denied, reload };
}
