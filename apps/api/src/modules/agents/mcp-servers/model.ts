/* What an operator sends to configure an MCP server for a workspace. */
import { z } from "zod";

/** Prefixes the server's tools as `<name>_<tool>`, so it keeps to a model's tool-name alphabet. */
export const serverName = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "name: lowercase letters, digits and dashes, up to 32");

const toolName = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,64}$/, "allow: tool names as the server lists them");

export const putMcpServerBody = z.object({
	url: z
		.string()
		.url()
		.refine((url) => /^https?:$/.test(new URL(url).protocol), "url: http or https only"),
	/** The server's own tool names the agent may call. Nothing else is offered. */
	allow: z.array(toolName).min(1, "allow: name at least one tool").max(50),
	/** Request headers, usually credentials. Stored sealed; omit to keep the stored ones, `{}` to clear them. */
	headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(4096)).optional(),
});
