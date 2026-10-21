import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboardRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

export function resolveUploadFilePath(pathname: string): string | null {
	if (!pathname.startsWith("/uploads/")) return null;
	let name: string;
	// Malformed percent-encoding (e.g. "/uploads/%") makes decodeURIComponent throw;
	// treat it as an invalid path, not a crash for callers like isSafeRefUrl.
	try {
		name = decodeURIComponent(pathname.slice("/uploads/".length));
	} catch {
		return null;
	}
	if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
		return null;
	}
	const candidates = [
		path.resolve("public/uploads", name),
		path.join(dashboardRoot, "public", "uploads", name),
		path.join(repoRoot, "public", "uploads", name),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
