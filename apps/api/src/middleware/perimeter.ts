/* THE PERIMETER, as the dispatch applies it. Every path this process answers
 * passes through `admit`, called first in the `fetch` dispatch in index.ts —
 * the only place that is true, because `/uploads/*` and `/internal/*` are both
 * resolved before the `api` Hono app, so middleware mounted on it would cover
 * neither. A plain function rather than Hono middleware for that reason. What is
 * exempt, and why, is decided in `@maleo/auth/perimeter`.
 *
 * Called before `resolveUploadFilePath`, deliberately: a file must not be read
 * from disk, nor its existence revealed by a 404-vs-401 difference, for a caller
 * who has not signed in. */
import { isSessionExempt } from "@maleo/auth/perimeter";
import { refuseAnonymous, resolveCaller, type Caller } from "@maleo/auth/session";

export type Admission =
	| { caller: Caller | null; refusal: null }
	| { caller: null; refusal: Response };

export async function admit(req: Request, pathname: string): Promise<Admission> {
	/* OPTIONS passes through. A preflight carries no cookie by definition, so
	 * refusing it would refuse every cross-origin request before the CORS
	 * middleware could answer — and the browser would report a CORS failure,
	 * never the 401, because a response it is not allowed to read is not a
	 * response it can show. The preflight grants nothing; the request behind
	 * it still has to carry a session. */
	const exempt = isSessionExempt(pathname);
	const caller = exempt ? null : await resolveCaller(req);
	if (req.method !== "OPTIONS" && !exempt && !caller)
		return { caller: null, refusal: refuseAnonymous() };
	return { caller, refusal: null };
}
