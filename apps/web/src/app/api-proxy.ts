/* The reverse proxy that makes the API same-origin to the browser.
 *
 * Its own module so it can be tested. What it carries is no longer just bytes:
 * once the API authenticates, this is the path the session cookie travels, in
 * both directions. A proxy that dropped or rewrote a cookie would produce a
 * sign-in that appears to succeed and a next request that is anonymous — the
 * session exists server-side with nothing able to present it.
 *
 * So: every request header is forwarded except `host`, and the upstream
 * response is returned untouched, `Set-Cookie` included.
 */

export interface ProxyOptions {
	/** Upstream API origins, no trailing slash, in the order to try them. */
	apiUrls: readonly string[];
	/** The connecting client's address, when the server can name it. */
	clientIp?: string | null;
}

/* The API replicas, from a comma-separated list, taken in turn: each call
 * returns every origin, starting one further along than the call before. */
export function apiUpstreams(list: string): () => readonly string[] {
	const urls = list
		.split(",")
		.map((u) => u.trim().replace(/\/+$/, ""))
		.filter(Boolean);
	let turn = 0;
	return () => {
		const start = turn;
		turn = (turn + 1) % urls.length;
		return [...urls.slice(start), ...urls.slice(0, start)];
	};
}

export async function proxyToApi(req: Request, options: ProxyOptions): Promise<Response> {
	const url = new URL(req.url);
	const headers = new Headers(req.headers);
	headers.delete("host");

	/* Without this every request reaches the API from one address — this
	 * process — and the API's per-address sign-in limiter becomes a single
	 * shared bucket. One person guessing passwords would lock out everybody,
	 * and the limiter would look like it was working.
	 *
	 * Appended rather than set, so an upstream proxy's chain is preserved. A
	 * client-supplied value is not trusted on its own: the API decides how far
	 * down the chain to read, and it is the last hop — this one — that it can
	 * actually believe. */
	if (options.clientIp) {
		const existing = headers.get("x-forwarded-for");
		headers.set(
			"x-forwarded-for",
			existing ? `${existing}, ${options.clientIp}` : options.clientIp,
		);
	}

	const init: RequestInit & { duplex?: "half" } = {
		method: req.method,
		headers,
		// manual: a redirect is the API's answer to the browser, not ours to
		// follow on its behalf.
		redirect: "manual",
		/* A client that disconnects mid-upload must abort the upstream request.
		 * Without it the streamed body simply ends, and the API receives a
		 * truncated upload that looks complete. */
		signal: req.signal,
	};
	const read = req.method === "GET" || req.method === "HEAD";
	if (!read) {
		init.body = req.body;
		init.duplex = "half";
		/* The API may answer a write before reading its whole body: an expired
		 * session, an oversized or invalid upload. A pooled upstream connection
		 * would then carry the unsent remainder, and the next request on it would
		 * reach the API mid-body and fail with a bare 400 (a 502 through Cloudflare).
		 * Writes therefore never reuse an upstream connection. */
		init.keepalive = false;
	}

	/* A read that cannot connect moves on to the next replica. A write does
	 * not: its body is a stream already handed to the first attempt, and a
	 * write the first replica may have applied must not be applied twice. */
	const targets = read ? options.apiUrls : options.apiUrls.slice(0, 1);
	let failure: unknown;
	for (const origin of targets) {
		try {
			return await fetch(`${origin}${url.pathname}${url.search}`, init);
		} catch (err) {
			failure = err;
		}
	}
	return new Response(
		JSON.stringify({ error: "api_unreachable", message: String(failure) }),
		// 503, not 502: Cloudflare replaces an origin 502 with its own page and the reason is lost.
		{ status: 503, headers: { "content-type": "application/json" } },
	);
}
