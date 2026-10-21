import { fieldOf } from "@maleo/shared";

/** A string property off an unchecked value, or undefined for anything else —
 *  a missing field and a field of the wrong type read the same, which is what
 *  every caller below already assumed. */
function stringField(value: unknown, key: string): string | undefined {
	const v = fieldOf(value, key);
	return typeof v === "string" ? v : undefined;
}
/* The little bit of Backblaze B2 this package needs.
 *
 * B2's own API rather than the S3-compatible one: the credentials already
 * configured — B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME — are exactly its input,
 * and an upload is three plain requests (authorise, get an upload url, put).
 * The S3 route needs an endpoint and region that are not set, and in practice an
 * AWS SDK client, which is a large dependency for uploading a few files a year.
 *
 * Shared by publish and enrich: publish writes beds and the manifest, enrich
 * rewrites only the manifest. */

export interface B2Auth {
	apiUrl: string;
	token: string;
	bucketId: string;
}

export interface B2Credentials {
	keyId: string;
	appKey: string;
	bucketName: string;
}

/** Read credentials, or say precisely which are missing. Callers refuse to do
 *  anything at all without the full set — a half-written library is worse than
 *  an untouched one. */
export function b2CredentialsFromEnv(): { credentials: B2Credentials } | { missing: string[] } {
	const keyId = process.env.B2_KEY_ID?.trim();
	const appKey = process.env.B2_APP_KEY?.trim();
	const bucketName = process.env.B2_BUCKET_NAME?.trim();
	const missing = [
		...(keyId ? [] : ["B2_KEY_ID"]),
		...(appKey ? [] : ["B2_APP_KEY"]),
		...(bucketName ? [] : ["B2_BUCKET_NAME"]),
	];
	if (missing.length) return { missing };
	return { credentials: { keyId: keyId!, appKey: appKey!, bucketName: bucketName! } };
}

/** Authorise once and resolve the bucket id. A key scoped to a single bucket
 *  reports that bucket directly; a wider key does not, so it is looked up. */
export async function authoriseB2({ keyId, appKey, bucketName }: B2Credentials): Promise<B2Auth> {
	const basic = Buffer.from(`${keyId}:${appKey}`).toString("base64");
	const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
		headers: { Authorization: `Basic ${basic}` },
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`b2_authorize_account ${res.status}: ${await res.text()}`);
	/* Read field by field off `unknown` rather than declaring a shape for
	 * Backblaze's response. `@maleo/stock` has no schema library — its only
	 * dependency is `@maleo/shared` — and `fieldOf` is what that package
	 * provides for exactly this: a property off a value nothing has checked yet,
	 * still typed `unknown` until the line below checks it.
	 *
	 * Every one of these already had a throw for the missing case; the difference
	 * is that a field of the WRONG type now takes that same throw, instead of
	 * being carried forward as a string it is not. */
	const body: unknown = await res.json().catch(() => undefined);
	const api = fieldOf(fieldOf(body, "apiInfo"), "storageApi");
	const apiUrl = stringField(api, "apiUrl");
	const authorizationToken = stringField(body, "authorizationToken");
	if (!apiUrl) throw new Error("b2_authorize_account returned no storage api url");
	if (!authorizationToken) throw new Error("b2_authorize_account returned no token");

	let bucketId =
		stringField(api, "bucketName") === bucketName ? stringField(api, "bucketId") : undefined;
	if (!bucketId) {
		const accountId = stringField(body, "accountId");
		if (!accountId)
			throw new Error(`key is not scoped to ${bucketName} and reported no account id`);
		const listed = await fetch(
			`${apiUrl}/b2api/v3/b2_list_buckets?accountId=${encodeURIComponent(accountId)}&bucketName=${encodeURIComponent(bucketName)}`,
			{ headers: { Authorization: authorizationToken }, signal: AbortSignal.timeout(20_000) },
		);
		if (!listed.ok) throw new Error(`b2_list_buckets ${listed.status}: ${await listed.text()}`);
		const buckets = fieldOf(await listed.json().catch(() => undefined), "buckets");
		const match = Array.isArray(buckets)
			? buckets.find((b) => stringField(b, "bucketName") === bucketName)
			: undefined;
		bucketId = stringField(match, "bucketId");
	}
	if (!bucketId) throw new Error(`could not resolve bucket id for ${bucketName}`);
	return { apiUrl, token: authorizationToken, bucketId };
}

export interface UploadOptions {
	/** Full path within the bucket, e.g. `music/manifest.json`. */
	path: string;
	bytes: Uint8Array;
	contentType: string;
	/** Omitted for anything whose name is not content-hashed — the manifest is
	 *  rewritten in place, so caching it for a year would hide every republish. */
	cacheControl?: string;
}

export async function uploadToB2(
	auth: B2Auth,
	{ path, bytes, contentType, cacheControl }: UploadOptions,
): Promise<void> {
	const urlRes = await fetch(
		`${auth.apiUrl}/b2api/v3/b2_get_upload_url?bucketId=${encodeURIComponent(auth.bucketId)}`,
		{
			headers: { Authorization: auth.token },
			signal: AbortSignal.timeout(20_000),
		},
	);
	if (!urlRes.ok) throw new Error(`b2_get_upload_url ${urlRes.status}: ${await urlRes.text()}`);
	/* Checked rather than asserted, the way `authoriseB2` checks its own fields
	 * three functions up. The assertion this replaces claimed both were strings;
	 * when B2 answers 200 with a different shape, `uploadUrl` was `undefined` and
	 * went straight into the `fetch` below, failing as a URL parse error that
	 * names neither B2 nor the field that was missing. */
	const upload: unknown = await urlRes.json();
	const uploadUrl = fieldOf(upload, "uploadUrl");
	const authorizationToken = fieldOf(upload, "authorizationToken");
	if (typeof uploadUrl !== "string") throw new Error("b2_get_upload_url returned no uploadUrl");
	if (typeof authorizationToken !== "string")
		throw new Error("b2_get_upload_url returned no authorizationToken");

	const sha1 = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
	const put = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			Authorization: authorizationToken,
			"X-Bz-File-Name": encodeURIComponent(path),
			"Content-Type": contentType,
			"Content-Length": String(bytes.byteLength),
			"X-Bz-Content-Sha1": sha1,
			...(cacheControl ? { "X-Bz-Info-Cache-Control": encodeURIComponent(cacheControl) } : {}),
		},
		body: bytes,
		signal: AbortSignal.timeout(120_000),
	});
	if (!put.ok) throw new Error(`b2_upload_file ${put.status}: ${await put.text()}`);
}
