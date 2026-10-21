/* The editor command vocabulary is not a browser concern: the server executes
 * the same data commands with the same result the editor produces
 * (`timeline-edit-commands`, "The command vocabulary is shared outside the
 * browser"). This runs one of the golden fixtures from inside the API. */
import { expect, test } from "vite-plus/test";
import { readFileSync, readdirSync } from "node:fs";
import { applyCommand, execute, type EditorCommand, type EditScope } from "@maleo/shared/editor";

interface Fixture {
	scope: EditScope;
	command: EditorCommand;
	expectedScope: EditScope;
	expectedInverse: EditorCommand;
	expectedRestored: EditScope;
}

const fixturePath = new URL(
	"../../../../packages/shared/src/editor/fixtures/batch/several-entities.json",
	import.meta.url,
);
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("the API executes an editor command exactly as the editor does", () => {
	const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
	const result = execute(fixture.scope, fixture.command);
	expect(asJson(result.scope)).toEqual(fixture.expectedScope);
	expect(asJson(result.inverse)).toEqual(fixture.expectedInverse);
	expect(asJson(applyCommand(result.scope, result.inverse))).toEqual(fixture.expectedRestored);
});

test("the shared editor module loads without a DOM", () => {
	expect("document" in globalThis).toBe(false);
	expect(typeof execute).toBe("function");
});

for (const name of readdirSync(
	new URL("../../../../packages/shared/src/editor/fixtures/caption.edit/", import.meta.url),
)) {
	test(`API caption command matches golden ${name}`, () => {
		const fixture: Fixture = JSON.parse(
			readFileSync(
				new URL(
					`../../../../packages/shared/src/editor/fixtures/caption.edit/${name}`,
					import.meta.url,
				),
				"utf8",
			),
		);
		const result = execute(fixture.scope, fixture.command);
		expect(asJson(result.scope)).toEqual(fixture.expectedScope);
		expect(asJson(result.inverse)).toEqual(fixture.expectedInverse);
		expect(asJson(applyCommand(result.scope, result.inverse))).toEqual(fixture.expectedRestored);
	});
}
