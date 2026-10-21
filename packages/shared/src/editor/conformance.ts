/* Conformance at the editor's boundaries (`migrate-editor-to-shared-rust-core`,
 * task 4.9).
 *
 * The document contract VUI's kernel defined — read the same document twice,
 * apply what is accepted, write nothing for what is refused, take an inverse
 * back to where it started, refuse a version it does not support — is now the
 * contract of the command executor, the boundary every controller writes
 * through. A suite returns a report rather than calling anyone's `expect`, and a
 * failure names the rule it broke. The web's renderer adapter reports through
 * the same shape (`apps/web/src/controllers/playback/renderer-conformance.ts`). */
import { EDITOR_COMMAND_TYPES, type EditorCommand } from "./commands.ts";
import type { CommandExecutor } from "./engine-executor.ts";
import type { EditScope } from "./scope.ts";

/** One rule's outcome. */
export interface ConformanceCheck {
	/** Stable identifier for the rule, so a failure can be looked up. */
	readonly rule: string;
	/** The rule in the words of the contract. */
	readonly requirement: string;
	readonly passed: boolean;
	/** Present only on failure: what the subject did instead. */
	readonly detail?: string;
}

export interface ConformanceReport {
	readonly suite: string;
	readonly checks: readonly ConformanceCheck[];
	readonly passed: boolean;
}

export function conformanceReport(
	suite: string,
	checks: readonly ConformanceCheck[],
): ConformanceReport {
	return { suite, checks, passed: checks.every((check) => check.passed) };
}

/** A report as a failure message naming every broken rule, or `undefined` when it passed. */
export function describeFailures(report: ConformanceReport): string | undefined {
	const failures = report.checks.filter((check) => !check.passed);
	if (failures.length === 0) return undefined;
	const lines = failures.map(
		(check) =>
			`  ${check.rule}: ${check.requirement}${check.detail ? `\n    ${check.detail}` : ""}`,
	);
	return `${report.suite}: ${failures.length} of ${report.checks.length} rules failed\n${lines.join("\n")}`;
}

export const EXECUTOR_CONFORMANCE_RULES = [
	"schema-version",
	"read-stable",
	"apply-accepted",
	"apply-rejected",
	"inversion",
	"vocabulary",
] as const;

export interface ExecutorConformanceOptions {
	/** A fresh executor per run. */
	create(): CommandExecutor;
	/** A scope the executor must admit, holding at least one clip. */
	scope: EditScope;
	/** A command it must accept against `scope`, changing it. */
	acceptable: EditorCommand;
	/** A command it must refuse against `scope`. */
	rejectable: EditorCommand;
}

function check(
	rule: (typeof EXECUTOR_CONFORMANCE_RULES)[number],
	requirement: string,
	passed: boolean,
	detail?: string,
): ConformanceCheck {
	return { rule, requirement, passed, detail: passed ? undefined : detail };
}

function attempt<T>(run: () => T): { value: T } | { error: string } {
	try {
		return { value: run() };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

const text = (scope: EditScope): string =>
	JSON.stringify({
		mediaAssets: scope.mediaAssets,
		doc: scope.doc,
		slides: scope.slides,
		posts: scope.posts,
	});

/** Run every executor rule against one executor. */
export function executorConformance(options: ExecutorConformanceOptions): ConformanceReport {
	const executor = options.create();
	const checks: ConformanceCheck[] = [];
	const before = text(options.scope);

	// SAFETY: off the type on purpose — a version this build does not know is exactly the input under test.
	const future: EditScope = {
		...options.scope,
		doc: { ...options.scope.doc, schemaVersion: 3 as 2 },
	};
	const refusedVersion = attempt(() => executor.execute(future, { type: "noop" }));
	checks.push(
		check(
			"schema-version",
			"A document version the executor does not support is refused before anything runs.",
			"error" in refusedVersion,
			"a schemaVersion 3 document was executed",
		),
	);

	const unchanged = attempt(() => executor.execute(options.scope, { type: "noop" }));
	checks.push(
		check(
			"read-stable",
			"Executing nothing returns the same document, value for value.",
			"value" in unchanged && text(unchanged.value.scope) === before,
			"a noop changed the document",
		),
	);

	const accepted = attempt(() => executor.execute(options.scope, options.acceptable));
	checks.push(
		check(
			"apply-accepted",
			"An accepted command returns a changed document and leaves its input untouched.",
			"value" in accepted &&
				text(accepted.value.scope) !== before &&
				text(options.scope) === before,
			"error" in accepted ? accepted.error : "the input changed, or the result did not",
		),
	);

	const rejected = attempt(() => executor.execute(options.scope, options.rejectable));
	const after = attempt(() => executor.execute(options.scope, { type: "noop" }));
	checks.push(
		check(
			"apply-rejected",
			"A refused command throws and writes nothing.",
			"error" in rejected && "value" in after && text(after.value.scope) === before,
			"the refused command ran, or changed what the executor holds",
		),
	);

	const inverted =
		"value" in accepted
			? attempt(() => executor.execute(accepted.value.scope, accepted.value.inverse))
			: undefined;
	checks.push(
		check(
			"inversion",
			"The inverse an accepted command returns restores the prior document exactly.",
			inverted !== undefined && "value" in inverted && text(inverted.value.scope) === before,
			"the inverse did not restore the document",
		),
	);

	// SAFETY: off the type on purpose, arriving as wire data would — a command type outside the vocabulary is exactly the input under test.
	const outside = JSON.parse('{"type":"clip.teleport"}') as EditorCommand;
	const unknown = attempt(() => executor.execute(options.scope, outside));
	checks.push(
		check(
			"vocabulary",
			`A command outside the ${EDITOR_COMMAND_TYPES.length}-type vocabulary is refused.`,
			"error" in unknown,
			"an unknown command type was executed",
		),
	);

	return conformanceReport("executor", checks);
}
