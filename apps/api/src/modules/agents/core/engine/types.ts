/* What the workflow engine runs: registered operations, facts and rules.
 *
 * An operation is code with an id, an input and an output schema, and the
 * prompts, tools and capabilities it may use. Facts and rules are read-only
 * projections a definition's conditions may name; they are the only way a
 * condition sees the run, so a definition cannot reach into the run record. */
import type { z } from "zod";
import type { AgentJob } from "../model.ts";

import type { Capability } from "../../../../lib/capability-scope.ts";

export type { Capability };

export interface OperationContext<TState = FlowState> {
	job: AgentJob;
	/** The flow state as of this node; read-only. */
	state: TState;
	/** The answer a suspend node's `onAnswer` receives. */
	answer?: string;
	toolCallId: string;
}

export type FlowState = Readonly<Record<string, FlowValue>>;
/** Flow state is JSON: it crosses a process boundary inside the run record. */
export type FlowValue =
	| string
	| number
	| boolean
	| null
	| readonly FlowValue[]
	| { readonly [key: string]: FlowValue };

export interface Operation<
	I extends z.ZodTypeAny = z.ZodTypeAny,
	O extends z.ZodTypeAny = z.ZodTypeAny,
> {
	readonly id: string;
	readonly description: string;
	readonly input: I;
	readonly output: O;
	readonly prompts: readonly string[];
	readonly tools: readonly string[];
	readonly capabilities: readonly Capability[];
	/** Composition templates the operation renders itself (not sent as requests); for inspection. */
	readonly renders?: readonly string[];
	/** Runs outside capability enforcement, with this reason. Only for wrapping a
	 *  path not yet ported to a definition (story asset generation, step 3). */
	readonly unscoped?: string;
	run(input: z.output<I>, context: OperationContext): Promise<z.input<O>>;
}

export function defineOperation<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
	operation: Operation<I, O>,
): Operation<I, O> {
	return operation;
}

/** What a fact or rule reads: the run's product record, never its raw shape in a definition. */
export interface ProjectionContext {
	job: AgentJob;
}

export interface Fact {
	readonly id: string;
	readonly description: string;
	read(context: ProjectionContext): FlowValue | undefined;
}

export interface Rule {
	readonly id: string;
	readonly description: string;
	test(context: ProjectionContext): boolean | Promise<boolean>;
}
