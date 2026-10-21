import { expect, test } from "vite-plus/test";
import { agentTemplateCatalogSchema } from "@maleo/shared";
import fixture from "../../../visual/fixtures/agent-templates.json";
import { selectedTemplate, templateSelection } from "./template-explorer.ts";

const catalog = agentTemplateCatalogSchema.parse(fixture);
const workflow = catalog.definitions.find((item) => item.id === "workflow:plan_story")!;
test("canonical inspection identity is independent from workflow navigation", () => {
	expect(selectedTemplate(catalog, { section: "tools", inspect: workflow.id })).toBe(workflow);
	expect(selectedTemplate(catalog, { section: "workflows", inspect: "unknown" })).toBeUndefined();
	expect(templateSelection(workflow)).toEqual({ section: "workflows", workflow: workflow.id });
});
