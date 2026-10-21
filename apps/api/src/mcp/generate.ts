/* The tool table MCP serves (design decision 9).
 *
 * Project reads, research and direct edits are the agent's own registry entries,
 * served with their own input schema plus the project they act on, so the agent
 * and an MCP client validate the same arguments. A direct edit never runs outside
 * a run: it runs as a single-tool run in the project chat (expose-direct-mcp-tools),
 * under the same approvals, fencing, metering and apply path as any run. Project
 * resolution and run delegation are MCP-only entries over the project and run
 * services. Workflows (a whole build, a plan, generation from a plan) stay
 * behind `run_agent`. */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOLS, toolByName } from "../modules/agents/core/registry.ts";
import { RUNTIME_TOOL_NAMES } from "../modules/agents/core/runtime/tools/registry-tools.ts";
import type { ContentType } from "../modules/agents/core/types.ts";

/** Read-only project state, each for its content type (the registry entry's own). */
export const MCP_PROJECT_READS = ["view_timeline", "read_skill"] as const;
/** Research changes no project content, so it serves any project that has an agent. */
export const MCP_RESEARCH = ["search_web", "read_web_page", "research_topic"] as const;
/** Direct edits: the registry's mutate and generate tools the agent itself calls —
 *  not the runtime's own (asking, finishing, the workflows' stages). */
export const MCP_EDITS: readonly string[] = TOOLS.filter(
	(tool) =>
		(tool.kind === "mutate" || tool.kind === "generate") && !RUNTIME_TOOL_NAMES.has(tool.name),
).map((tool) => tool.name);

const EDIT_NOTE =
	"Direct edit: runs as a single-tool run in the project chat and returns its result. An edit of existing work waits for approval and returns the pending action; answer it with answer_action.";

const projectId = z
	.string()
	.min(1, "projectId is required")
	.describe("The project's id, from list_projects.");
/* Bounds on what a client sends the agent. A scripted client at the key's rate
 * limit must not be able to push arbitrarily large prompts into a workspace's spend. */
const MAX_INSTRUCTION_CHARS = 8_000;
const MAX_ANSWER_CHARS = 4_000;

const runId = z.string().min(1, "runId is required").describe("The run's id, from run_agent.");

/** The MCP-only tools: their inputs, descriptions, and whether they change anything. */
export const MCP_SERVICE_TOOLS = {
	list_projects: {
		readOnly: true,
		input: z.object({}),
		description: "List the projects this key can reach: id, title, content type, workspace.",
	},
	get_project: {
		readOnly: true,
		input: z.object({ projectId }),
		description:
			"Read one project: its title, content type, the read and edit tools that apply to it, and its active run if any.",
	},
	run_agent: {
		readOnly: false,
		input: z.object({
			projectId,
			instruction: z
				.string()
				.min(1, "instruction is required")
				.max(MAX_INSTRUCTION_CHARS, `instruction: at most ${MAX_INSTRUCTION_CHARS} characters`)
				.describe("What to do, as you would type it in the project chat."),
		}),
		description:
			"Start the project's agent with an instruction, in the project chat. Returns the run id at once; follow it with get_run. Changes apply under the same approvals as in the product.",
	},
	get_run: {
		readOnly: true,
		input: z.object({ runId }),
		description:
			"A run's status, its recent progress, the action it waits on (with its actionId and options), and its result.",
	},
	answer_action: {
		readOnly: false,
		input: z.object({
			runId,
			actionId: z
				.string()
				.min(1, "actionId is required")
				.describe("The pending action's id, from get_run."),
			answer: z
				.string()
				.min(1, "answer is required")
				.max(MAX_ANSWER_CHARS, `answer: at most ${MAX_ANSWER_CHARS} characters`)
				.describe("An option's value (e.g. approve, reject) or a free answer."),
		}),
		description:
			"Answer the action a run waits on. Only the action it is waiting on is accepted; anything else changes nothing.",
	},
	cancel_run: {
		readOnly: false,
		input: z.object({ runId }),
		description: "Stop a run now. Work it already applied stays.",
	},
} as const;

export type McpServiceTool = keyof typeof MCP_SERVICE_TOOLS;

function registryTool(name: string) {
	const tool = toolByName.get(name);
	if (!tool) throw new Error(`MCP tool ${name} must be a registry tool`);
	return tool;
}

/** The object a registry tool's input describes. A refined input lists its object; dispatch still applies the refinement. */
function inputObject(name: string): z.ZodObject<z.ZodRawShape> {
	const input = registryTool(name).input;
	const object = input instanceof z.ZodEffects ? input.innerType() : input;
	if (!(object instanceof z.ZodObject))
		throw new Error(`MCP tool ${name} must have an object input`);
	return object;
}

function spec(
	name: string,
	description: string,
	input: z.ZodObject<z.ZodRawShape>,
	readOnly: boolean,
): Tool {
	// SAFETY: a ZodObject converts to a JSON Schema object (`type: "object"` with properties and required).
	const inputSchema = zodToJsonSchema(input, {
		target: "jsonSchema7",
		$refStrategy: "none",
	}) as Tool["inputSchema"];
	return { name, description, inputSchema, annotations: { readOnlyHint: readOnly } };
}

/** Every served tool, as `tools/list` returns it. */
export function mcpTools(): Tool[] {
	const reads = [...MCP_PROJECT_READS, ...MCP_RESEARCH].map((name) =>
		spec(name, registryTool(name).description, inputObject(name).extend({ projectId }), true),
	);
	const edits = MCP_EDITS.map((name) =>
		spec(
			name,
			`${EDIT_NOTE} ${registryTool(name).description}`,
			inputObject(name).extend({ projectId }),
			false,
		),
	);
	const services = Object.entries(MCP_SERVICE_TOOLS).map(([name, tool]) =>
		spec(name, tool.description, tool.input, tool.readOnly),
	);
	return [...services, ...reads, ...edits];
}

/** The project reads that apply to a content type. Image and text projects are
 *  retired and have no agent, so nothing applies to them. */
export function readsFor(contentType: ContentType): string[] {
	if (contentType !== "video") return [];
	return MCP_PROJECT_READS.filter(
		(name) => registryTool(name).contentType?.includes(contentType) ?? true,
	);
}

/** The direct edits that apply to a content type. */
export function editsFor(contentType: ContentType): string[] {
	if (contentType !== "video") return [];
	return MCP_EDITS.filter((name) => registryTool(name).contentType?.includes(contentType) ?? true);
}

const EDITS: ReadonlySet<string> = new Set(MCP_EDITS);

export function isEdit(name: string): boolean {
	return EDITS.has(name);
}

const RESEARCH: ReadonlySet<string> = new Set(MCP_RESEARCH);
const REGISTRY_READS: ReadonlySet<string> = new Set([...MCP_PROJECT_READS, ...MCP_RESEARCH]);

export function isRegistryRead(name: string): boolean {
	return REGISTRY_READS.has(name);
}

export function isResearch(name: string): boolean {
	return RESEARCH.has(name);
}

export function isServiceTool(name: string): name is McpServiceTool {
	return Object.hasOwn(MCP_SERVICE_TOOLS, name);
}
