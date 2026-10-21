/* One post-link owner for local and Docker builds. O1 wins both raw and gzip budgets. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const optimizer = require.resolve("binaryen/bin/wasm-opt");
const version = JSON.parse(readFileSync(require.resolve("binaryen/package.json"), "utf8")).version;
const flags = [
	"-O1",
	"--enable-bulk-memory",
	"--enable-sign-ext",
	"--enable-nontrapping-float-to-int",
	"--enable-multivalue",
	"--enable-reference-types",
];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function optimizeEditorWasm(path: string): string {
	const target = path.replace(/\.wasm$/, ".optimized.wasm");
	if (target === path) throw new Error("Expected .wasm input");
	const stamp = `${target}.stamp`,
		identity = JSON.stringify([version, flags]);
	const bytes = readFileSync(path);
	const inputIdentity = identity + digest(bytes);
	if (
		existsSync(stamp) &&
		existsSync(target) &&
		readFileSync(stamp, "utf8") === inputIdentity + digest(readFileSync(target))
	)
		return target;
	const output = `${target}.${process.pid}.tmp`;
	execFileSync(process.execPath, [optimizer, path, ...flags, "-o", output], { stdio: "inherit" });
	const optimized = readFileSync(output);
	if (!WebAssembly.validate(optimized)) throw new Error("Optimized editor engine is invalid");
	renameSync(output, target);
	writeFileSync(stamp, inputIdentity + digest(optimized));
	return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (!process.argv[2]) throw new Error("Expected editor WASM path");
	optimizeEditorWasm(resolve(process.argv[2]));
}
