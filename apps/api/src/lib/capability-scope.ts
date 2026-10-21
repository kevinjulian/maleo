/* The declared-capability scope an operation runs in.
 *
 * The engine runs every operation inside an async-local scope holding what the
 * operation declared: its prompts, tools and capabilities. The chokepoints — the
 * text runner, the research provider, the media transport — ask this module before
 * they send or charge anything, and an undeclared use throws there. Code running
 * outside any engine scope (paths not yet ported to definitions) is unaffected.
 *
 * Only executed paths are checked; the validator separately requires a step to
 * list exactly its operation's prompts and tools. */
import { AsyncLocalStorage } from "node:async_hooks";
/** Model text calls and media generation are separate grants. */
export type Capability = "llm:text" | "media:generate";

interface DeclaredUse {
	id: string;
	prompts: readonly string[];
	tools: readonly string[];
	capabilities: readonly Capability[];
}

interface OperationScope {
	operation: string;
	prompts: ReadonlySet<string>;
	tools: ReadonlySet<string>;
	capabilities: ReadonlySet<Capability>;
}

const storage = new AsyncLocalStorage<OperationScope>();

export class UndeclaredUseError extends Error {}

export function runInOperationScope<T>(operation: DeclaredUse, run: () => Promise<T>): Promise<T> {
	return storage.run(
		{
			operation: operation.id,
			prompts: new Set(operation.prompts),
			tools: new Set(operation.tools),
			capabilities: new Set(operation.capabilities),
		},
		run,
	);
}

/** The operation the caller runs under, when it runs under one. */
export function currentOperation(): string | undefined {
	return storage.getStore()?.operation;
}

/** Refuse a capability the running operation did not declare. */
export function requireCapability(capability: Capability, what: string): void {
	const scope = storage.getStore();
	if (scope && !scope.capabilities.has(capability))
		throw new UndeclaredUseError(
			`operation "${scope.operation}" did not declare ${capability} (${what})`,
		);
}

/** Refuse a model request for a prompt the running operation did not declare.
 *  A request with no template id is untemplated text, which no operation may send. */
export function requirePrompt(promptId: string | undefined): void {
	const scope = storage.getStore();
	if (!scope) return;
	requireCapability("llm:text", promptId ?? "untemplated prompt");
	if (!promptId || !scope.prompts.has(promptId))
		throw new UndeclaredUseError(
			`operation "${scope.operation}" did not declare prompt ${promptId ? `"${promptId}"` : "(untemplated text)"}`,
		);
}

/** Refuse a tool call the running operation did not declare. */
export function requireTool(tool: string): void {
	const scope = storage.getStore();
	if (scope && !scope.tools.has(tool))
		throw new UndeclaredUseError(`operation "${scope.operation}" did not declare tool "${tool}"`);
}
