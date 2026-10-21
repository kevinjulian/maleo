import { expect, test } from "vite-plus/test";
import { sampleScope } from "./sample-scope.ts";

/* A command and the scope it runs against have to cross a process, WASM or FFI
 * boundary as JSON, so nothing in the scope may be lost by serializing it. */
test("a representative scope survives a JSON round trip unchanged", () => {
	const scope = sampleScope();
	expect(JSON.parse(JSON.stringify(scope))).toStrictEqual(scope);
});
