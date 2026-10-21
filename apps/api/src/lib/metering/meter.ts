/* Metering — one way to spend on a generation.
 *
 * Spend used to be governed by two systems that could not see each other: the
 * credit ledger (agent path, `runBillableOperation`) and the per-workspace image
 * policy quota (route path, `canGenerate`). A generation made through the route
 * never reached the ledger; one made by the agent never counted against the
 * workspace's quota. Prices were literals at each call site.
 *
 * `meter` is the single entry: quote from the price table, check the workspace
 * gate when there is a workspace, run the operation inside the ledger's
 * reserve/capture bracket, and record usage.
 *
 * `scope` and `workspace` are not the same question and both have to be answered:
 * `scope` is whose ledger the spend lands on, `workspace` is whose quota gates it.
 * A caller that sets only the first bills a workspace without ever asking whether
 * it was allowed another generation. */
import { runBillableOperation, type CreditScopeType } from "../credit-service.ts";
import { canGenerate } from "../image-policy.ts";
import { generationKey } from "../generation/generation-scope.ts";
import { requireCapability } from "../capability-scope.ts";
import { providerCostUsd, quoteFor, unitFor, type MeteredOperation } from "./prices.ts";

/** Thrown when the workspace's image policy refuses another generation. Routes
 *  map this to 429; the agent surfaces it as a failed tool call. */
export class QuotaExceededError extends Error {
	readonly gate: { ok: boolean; reason?: string };
	constructor(gate: { ok: boolean; reason?: string }) {
		super(gate.reason ?? "generation quota exceeded");
		this.name = "QuotaExceededError";
		this.gate = gate;
	}
}

export interface MeterInput<T> {
	operation: MeteredOperation;
	/** Units billed: images generated, characters synthesised. */
	quantity: number;
	provider: string;
	model: string;
	/** Prefix for the reference/idempotency ids, e.g. "image:scene". */
	reference: string;
	/** Whose budget this is. Defaults to the workspace's own ledger when a
	 *  `workspace` is given, and to the ledger's default scope otherwise — every
	 *  call site used to spell that fallback out, which is how a generation ends up
	 *  billed to the wrong ledger by omission. Set it only to bill somewhere other
	 *  than the workspace being gated. */
	scope?: { type: CreditScopeType; id: string };
	/** When present, the workspace's image-policy quota gates the run. */
	workspace?: string;
	metadata?: Record<string, unknown>;
	/** What is generated (prompt, references, voice…). Inside a generation scope
	 *  it keys the operation, so a retried step is charged once and its run is
	 *  handed the key to find the attempt it already made. */
	identity?: unknown;
	run: (generationKey?: string) => Promise<T>;
}

function operationId(reference: string): string {
	return `${reference}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function meter<T>(input: MeterInput<T>): Promise<T> {
	// Before any gate, quote or charge: an engine operation must declare media generation.
	requireCapability("media:generate", `${input.operation} via ${input.provider}`);
	if (input.workspace) {
		const gate = await canGenerate(input.workspace);
		if (!gate.ok) throw new QuotaExceededError(gate);
	}

	const quote = quoteFor({
		operation: input.operation,
		quantity: input.quantity,
		provider: input.provider,
		model: input.model,
	});
	const key =
		input.identity === undefined ? undefined : generationKey([input.reference, input.identity]);
	const id = key ?? operationId(input.reference);
	const scope =
		input.scope ??
		(input.workspace ? { type: "workspace" as const, id: input.workspace } : undefined);

	return runBillableOperation({
		scopeType: scope?.type,
		scopeId: scope?.id,
		referenceType: `${input.operation}_generation`,
		referenceId: id,
		idempotencyKey: id,
		quote,
		usageRecord: {
			operation: input.operation,
			provider: input.provider,
			model: input.model,
			quantity: input.quantity,
			unit: unitFor(input.operation),
			providerCostUsd: providerCostUsd(input.operation, input.quantity, input.provider),
			metadata: { ...input.metadata, ...(input.workspace ? { workspace: input.workspace } : {}) },
		},
		run: () => input.run(key),
	});
}
