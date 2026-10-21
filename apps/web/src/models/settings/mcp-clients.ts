/* How each MCP client connects to maleo.
 *
 * Every client takes the same endpoint and a Bearer key; only where the config
 * lives and how it spells the URL and header differ, taken from each tool's own
 * documentation. With no key yet, the snippet carries a placeholder the user
 * replaces; with a key just created, the snippet carries the key itself, so it is
 * one copy and paste. */

/** The name the server is registered under in each client. */
export const MCP_SERVER_NAME = "maleo";
export const MCP_KEY_PLACEHOLDER = "<API_KEY>";
/** The environment variable Codex reads the key from (it does not store keys in its config). */
export const CODEX_KEY_ENV = "MALEO_MCP_KEY";

export interface McpClientGuide {
	id: string;
	label: string;
	/** Where the snippet goes, when it is a file rather than a command. */
	file?: string;
	note?: string;
	snippet: string;
}

export function mcpClientGuides(endpoint: string, key: string | null): McpClientGuide[] {
	const token = key ?? MCP_KEY_PLACEHOLDER;
	const name = MCP_SERVER_NAME;
	return [
		{
			id: "codex",
			label: "Codex CLI",
			note: "Run in your terminal. Codex reads the key from the environment variable, so keep the export in your shell profile.",
			snippet: `export ${CODEX_KEY_ENV}="${token}"\ncodex mcp add ${name} --url ${endpoint} --bearer-token-env-var ${CODEX_KEY_ENV}`,
		},
		{
			id: "claude-code",
			label: "Claude Code",
			note: "Run in your terminal.",
			snippet: `claude mcp add --transport http ${name} ${endpoint} \\\n  --header "Authorization: Bearer ${token}"`,
		},
		{
			id: "cursor",
			label: "Cursor",
			file: "~/.cursor/mcp.json",
			snippet: JSON.stringify(
				{
					mcpServers: { [name]: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } },
				},
				null,
				2,
			),
		},
		{
			id: "vscode",
			label: "VS Code",
			file: ".vscode/mcp.json",
			snippet: JSON.stringify(
				{
					servers: {
						[name]: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } },
					},
				},
				null,
				2,
			),
		},
		{
			id: "other",
			label: "Other",
			note: `Any client that speaks MCP over Streamable HTTP. Point it at the endpoint and send the header Authorization: Bearer ${token}.`,
			snippet: endpoint,
		},
	];
}
