import { getLegacyMediaLink, mediaObjectUrl } from "@maleo/db/media-objects";
import type { Db } from "@maleo/db/handle";

const LEGACY_PATH = /^\/(uploads|files|api\/image-gen\/files)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Resolve immutable storyboard URLs in the response; stored snapshots stay intact. */
export async function resolveLegacyStoryboardMedia(
	value: unknown,
	workspace: string,
	db?: Db,
): Promise<unknown> {
	const origins = new Set(
		[
			process.env.MALEO_API_URL,
			process.env.MALEO_WEB_URL,
			process.env.MALEO_GEN_WORKER_URL,
			process.env.MALEO_IMAGE_GEN_URL,
		]
			.filter((url): url is string => Boolean(url))
			.map((url) => new URL(url).origin),
	);
	const cache = new Map<string, string | null>();
	const resolve = async (node: unknown): Promise<unknown> => {
		if (typeof node === "string") {
			if (!node.includes("/files/") && !node.includes("/uploads/")) return node;
			let url: URL;
			try {
				url = new URL(node, "http://local.invalid");
			} catch {
				return node;
			}
			const relative = node.startsWith("/") && !node.startsWith("//");
			if (!relative && !origins.has(url.origin)) return node;
			let pathname: string;
			try {
				pathname = decodeURIComponent(url.pathname);
			} catch {
				return node;
			}
			if (!LEGACY_PATH.test(pathname)) return node;
			let mapped = cache.get(pathname);
			if (mapped === undefined) {
				const id = await getLegacyMediaLink(pathname, workspace, db);
				mapped = id ? mediaObjectUrl(id) : null;
				cache.set(pathname, mapped);
			}
			return mapped ?? node;
		}
		if (Array.isArray(node)) return Promise.all(node.map(resolve));
		if (node && typeof node === "object") {
			return Object.fromEntries(
				await Promise.all(
					Object.entries(node).map(async ([key, item]) => [key, await resolve(item)] as const),
				),
			);
		}
		return node;
	};
	return resolve(value);
}
