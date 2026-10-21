import { parse as parseYaml } from "yaml";
import { type Workspace, WorkspaceSchema } from "./schema.ts";

/* Parse a configuration document. The document is a database row (see
 * config-yaml.ts); nothing reads a workspace's configuration from a file. */
export function loadWorkspaceFromString(yaml: string): Workspace {
	return WorkspaceSchema.parse(parseYaml(yaml) ?? {});
}
