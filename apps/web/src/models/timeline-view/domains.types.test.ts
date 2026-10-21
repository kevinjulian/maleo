/* The domain separation, asserted by the compiler rather than at runtime.
 *
 * Every `@ts-expect-error` below is the assertion: if the mistake it describes
 * ever stops being a type error, `bun run typecheck` fails on the unused
 * suppression. That is the whole mechanism — the spec asks for a rate mismatch
 * to be rejected "rather than producing a plausible wrong number", and a
 * runtime test cannot show that a wrong number was never producible.
 *
 * It is also a `.test.ts` so `bun test` loads it, which keeps the file honest:
 * a type-only fixture that stops compiling as a module would otherwise pass by
 * never being read.
 */
import { expect, test } from "vite-plus/test";
import { rational } from "./rational.ts";
import { timebase } from "./timebase.ts";
import {
	addProject,
	addSource,
	compareTime,
	framesToProject,
	framesToSource,
	projectTime,
	sourceTime,
	subtractProject,
	type ProjectTime,
	type SourceTime,
} from "./tick.ts";

const project = timebase(rational(30000, 1001));
const source = timebase(rational(25, 1));

const position: ProjectTime = framesToProject(100, project);
const sourceIn: SourceTime = framesToSource(50, source);

test("a source duration cannot be added to a project position", () => {
	// @ts-expect-error a SourceTime is not a ProjectTime, which is the point
	const wrong = (): ProjectTime => addProject(position, sourceIn);
	void wrong;

	// @ts-expect-error and the mistake is symmetric
	const alsoWrong = (): SourceTime => addSource(sourceIn, position);
	void alsoWrong;

	// @ts-expect-error subtraction is not a way around it either
	const stillWrong = (): ProjectTime => subtractProject(position, sourceIn);
	void stillWrong;

	/* Crossing domains is the engine's (`crates/editor-core/src/time.rs`
	 * `source_duration_to_project`), named on both timebases there. */
});

test("times in different domains cannot be compared as if they were one", () => {
	// @ts-expect-error `compareTime` is generic in ONE domain, not across two
	const wrong = (): number => compareTime(position, sourceIn);
	void wrong;

	expect(compareTime(position, framesToProject(1, project))).toBe(1);
});

test("a bare tick count is not a time, in either domain", () => {
	// @ts-expect-error a number carries no domain, so it is not admissible
	const wrong = (): ProjectTime => addProject(position, 42);
	void wrong;

	// @ts-expect-error and an object without the discriminant is not either
	const alsoWrong = (): ProjectTime => addProject(position, { ticks: 42 });
	void alsoWrong;

	expect(addProject(position, projectTime(42)).ticks).toBe(position.ticks + 42);
});

test("a project time cannot be passed where a source time is required", () => {
	const takesSource = (value: SourceTime): number => value.ticks;
	// @ts-expect-error the two are structurally distinct, not merely named apart
	const wrong = (): number => takesSource(position);
	void wrong;

	expect(takesSource(sourceTime(7))).toBe(7);
});
