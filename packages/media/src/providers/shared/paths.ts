/* Resolving a caller-supplied reference to a local file — the one implementation.
 *
 * This is input validation at a trust boundary: a reference URL arrives from a
 * generation request, and this decides which bytes on disk a provider is allowed
 * to read. It previously existed as two byte-identical copies, in
 * `media-provider-codex` and `media-provider-cloudflare-ai`, each carrying a
 * comment asking a human to apply fixes to the other. They had not drifted —
 * verified before the merge — but nothing except that comment was preventing it,
 * and a traversal guard that holds in one provider and not another is a hole
 * with no symptom.
 *
 * Only MANAGED surfaces resolve: the worker's own cache and the uploads
 * directories. An arbitrary remote URL never becomes a local read.
 *
 * `resolveRepoPath` and the cache directory come from the media package's own
 * `paths.ts` rather than being recomputed here. The copies each derived the repo
 * root by walking up a fixed number of directories from their own file, which is
 * a value that changes when a file moves — exactly what happened when these
 * providers were folded into this package. */
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaWorkerCacheDir, resolveRepoPath } from "../../paths.ts";

function existingPath(candidates: string[]): string | null {
	return candidates.find((path) => existsSync(path)) ?? null;
}

/* Directories an `/uploads/<name>` reference may resolve inside.
 *
 * `apps/api/public/uploads` is where the API ACTUALLY WRITES, and leaving it
 * out is why a reference could cross from the API to this process and resolve to
 * nothing. Every upload path in the API — the clone library, the speech lab, the
 * story assets — is the relative string `public/uploads`, resolved against that
 * process's cwd, and the API runs from its own package directory. So the two
 * halves named the same URL and meant different folders, and the only reason it
 * went unnoticed is that nothing had needed the worker to READ an upload until a
 * cloned voice did.
 *
 * Stated as a repo-relative path rather than fixed by setting the env var
 * because a feature that only works once an operator exports something is a
 * feature that is broken by default. The env vars stay ahead of it for a
 * deployment where the two processes do not share a filesystem layout. */
function uploadRoots(): string[] {
	return [
		process.env.MALEO_UPLOADS_DIR,
		process.env.MALEO_API_UPLOADS_DIR,
		resolveRepoPath("apps/api/public/uploads"),
		resolveRepoPath("public/uploads"),
		resolve("public/uploads"),
	].filter((root): root is string => Boolean(root?.trim()));
}

/* Managed worker/API surfaces only — never a fetch of an arbitrary remote URL.
 *
 * The `/uploads/` branch rejects any name that decodes to something with a path
 * separator or a `..` segment, so the name can only ever be a leaf inside one of
 * the roots above. Order matters in both directions: `url.pathname` keeps percent
 * escapes, so `%2e%2e%2f` only becomes traversal once decoded and must be checked
 * after — while skipping the decode entirely would be safe but wrong, since an
 * ordinary name like `my%20photo.png` would then never resolve. */
function managedPath(pathname: string): string | null {
	if (pathname.startsWith("/api/image-gen/files/") || pathname.startsWith("/files/")) {
		return existingPath([join(mediaWorkerCacheDir(), basename(pathname))]);
	}
	if (!pathname.startsWith("/uploads/")) return null;
	let name: string;
	try {
		name = decodeURIComponent(pathname.slice("/uploads/".length));
	} catch {
		// A malformed escape is not a filename.
		return null;
	}
	if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
	return existingPath(uploadRoots().map((root) => join(root, name)));
}

/**
 * The local file a reference names, or `null` when it names none we may read.
 *
 * `null` is a refusal, not an error: the caller decides whether a reference it
 * cannot resolve is fatal. Both current callers refuse loudly rather than
 * dropping the reference, because a silently ignored reference produces a
 * plausible image that answers a different question.
 */
export function referenceToLocalPath(raw: string): string | null {
	if (raw.startsWith("file://")) {
		const path = fileURLToPath(raw);
		return existsSync(path) ? path : null;
	}
	if (isAbsolute(raw)) return existsSync(raw) ? raw : managedPath(raw);
	try {
		const url = new URL(raw);
		if (url.protocol === "file:") {
			const path = fileURLToPath(url);
			return existsSync(path) ? path : null;
		}
		if (url.protocol === "http:" || url.protocol === "https:") return managedPath(url.pathname);
	} catch {
		// Not a URL, so treat it as a relative filesystem path.
		const path = resolve(raw);
		return existsSync(path) ? path : null;
	}
	return null;
}
