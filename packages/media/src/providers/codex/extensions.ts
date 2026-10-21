/* Which image extension a Codex run produced.
 *
 * Codex reports a path rather than bytes, so the extension is how the cache
 * entry is named and how the worker later serves it. This lived in this
 * provider's `paths.ts` alongside the reference resolver; the resolver was
 * shared with another provider and moved to `../shared/paths.ts`, while this is
 * about Codex's own output and stays here. */
import { extname } from "node:path";
import { SUPPORTED_IMAGE_EXTENSIONS, type CodexImageExtension } from "./constants.ts";

export function imageExtensionFromPath(path: string): CodexImageExtension | null {
	const ext = extname(path).replace(".", "").toLowerCase();
	// `.find` returns the MEMBER, so the extension is narrowed by the lookup that
	// proved it rather than by a claim made after the fact. `oneOf` is a type
	// guard on its first argument, which is a plain `string` here, so it does not
	// narrow the return — this stays as it was written.
	return SUPPORTED_IMAGE_EXTENSIONS.find((candidate) => candidate === ext) ?? null;
}
