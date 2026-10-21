/* Minimal PATH lookup. Media must not depend on API just to share ten lines. */
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export function whichSync(command: string): string | null {
	if (isAbsolute(command)) return isExecutable(command) ? command : null;
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const candidate = join(dir, command);
		if (isExecutable(candidate)) return candidate;
	}
	return null;
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
