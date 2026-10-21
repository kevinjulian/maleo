/* Credentials are read here so that `health()` and the generation path agree on
 * what "configured" means. Health must be answerable on a machine with no
 * credentials — every CI runner is one — so reading them never throws. */
import { ACCOUNT_ID_ENV, API_TOKEN_ENV } from "./models.ts";
import { resolveConfig } from "../config.ts";

export interface CloudflareCredentials {
	accountId: string;
	apiToken: string;
}

export function readCredentials(): CloudflareCredentials | null {
	const accountId = resolveConfig(ACCOUNT_ID_ENV);
	const apiToken = resolveConfig(API_TOKEN_ENV);
	if (!accountId || !apiToken) return null;
	return { accountId, apiToken };
}

export function requireCredentials(): CloudflareCredentials {
	const credentials = readCredentials();
	if (!credentials) {
		throw new Error(
			`Cloudflare image generation is unconfigured; set ${ACCOUNT_ID_ENV} and ${API_TOKEN_ENV}`,
		);
	}
	return credentials;
}
