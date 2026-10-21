/* The production engine registry: the planning definitions with the operations,
 * facts, rules and stage contracts they may name. Built on first use and validated
 * then, so a definition that names something unregistered fails before any run. */
import { ENGINE_CONTRACT_NAMES } from "../contracts.ts";
import { createEngineRegistry, type EngineRegistry } from "../registry.ts";
import { PLANNING_DEFINITIONS } from "./definitions.ts";
import { PLANNING_OPERATIONS } from "./operations.ts";
import { PLANNING_FACTS, PLANNING_RULES } from "./projections.ts";
import { CREATE_STORY_VIDEO, ONE_SHOT_OPERATIONS, ONE_SHOT_RULES } from "./one-shot.ts";

let registry: EngineRegistry | undefined;

export function planningRegistry(): EngineRegistry {
	registry ??= createEngineRegistry({
		definitions: [...PLANNING_DEFINITIONS, CREATE_STORY_VIDEO],
		operations: [...PLANNING_OPERATIONS, ...ONE_SHOT_OPERATIONS],
		facts: PLANNING_FACTS,
		rules: [...PLANNING_RULES, ...ONE_SHOT_RULES],
		contracts: ENGINE_CONTRACT_NAMES,
	});
	return registry;
}
