/* Reference inputs are constrained to worker-reachable managed files, then staged
 * through `codex exec -i <file>`. Anything that cannot be staged safely is
 * rejected loudly — a silently dropped reference produces a plausible-looking
 * image that ignores the caller's intent. */
import { referenceToLocalPath } from "../shared/paths.ts";

// `codex exec -i` takes repeats; four matches the other image providers' cap.
export const MAX_REFERENCES = 4;

export function resolveCodexReferences(referenceUrls: string[] | undefined): string[] {
	const requested = referenceUrls?.filter((url) => url.trim()) ?? [];
	if (requested.length === 0) return [];
	const unresolved = requested.filter((url) => referenceToLocalPath(url) === null);
	if (unresolved.length > 0) {
		throw new Error(
			`unsupported Codex image references (not worker-reachable managed files): ${unresolved.join(", ")}`,
		);
	}
	const unique = [...new Set(requested.map((url) => referenceToLocalPath(url)!))];
	if (unique.length > MAX_REFERENCES) {
		throw new Error(
			`Codex image generation accepts at most ${MAX_REFERENCES} references, received ${unique.length}`,
		);
	}
	return unique;
}
