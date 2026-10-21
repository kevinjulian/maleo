/* How a prompt template reads in the catalog: its text with every slot, constant,
 * formatter, include, condition and repeat named in place, its inputs, and its
 * response contract. A direct walk of the data production renders. */
import {
	templateReferences,
	type Expression,
	type PromptTemplate,
	type TemplateFilter,
	type TemplateNode,
} from "@maleo/shared";

const expression = (value: Expression): string => JSON.stringify(value);
const filters = (list: readonly TemplateFilter[] | undefined): string =>
	list?.length
		? ` | ${list.map((filter) => (typeof filter === "string" ? filter : JSON.stringify(filter))).join(" | ")}`
		: "";

function text(nodes: readonly TemplateNode[]): string {
	return nodes
		.map((node) => {
			if (typeof node === "string") return node;
			switch (node.type) {
				case "text":
					return node.text;
				case "slot":
					return `{{${node.path}${filters(node.filters)}}}`;
				case "const":
					return `{{const:${node.name}${filters(node.filters)}}}`;
				case "format":
					return `{{format:${node.name}(${Object.entries(node.in ?? {})
						.map(
							([name, binding]) =>
								`${name}=${typeof binding === "string" ? binding : JSON.stringify(binding.value)}`,
						)
						.join(", ")})${filters(node.filters)}}}`;
				case "include":
					return `{{include:${node.prompt}}}`;
				case "when":
					return `{{#when ${expression(node.if)}}}${text(node.then)}${node.else ? `{{else}}${text(node.else)}` : ""}{{/when}}`;
				case "each":
					return `{{#each ${node.path} as ${node.as}${node.sep !== undefined ? ` sep=${JSON.stringify(node.sep)}` : ""}}}${text(node.template)}${node.empty ? `{{empty}}${text(node.empty)}` : ""}{{/each}}`;
			}
		})
		.join("");
}

function conditions(nodes: readonly TemplateNode[]): string[] {
	return nodes.flatMap((node) => {
		if (typeof node === "string") return [];
		if (node.type === "when")
			return [
				`When ${expression(node.if)}`,
				...conditions(node.then),
				...conditions(node.else ?? []),
			];
		if (node.type === "each")
			return [
				`Repeat over ${node.path}`,
				...conditions(node.template),
				...conditions(node.empty ?? []),
			];
		return [];
	});
}

export function templateCatalogFacts(template: PromptTemplate) {
	const references = templateReferences(template);
	return {
		instructions: [text(template.body)],
		variables: [...new Set(references.paths.filter((path) => !path.startsWith("$")))].map(
			(path) => ({ name: path, type: "Template input", required: false, source: `slot ${path}` }),
		),
		conditions: [...new Set(conditions(template.body))],
		composition: references.includes,
		output: template.response
			? [
					`Parser: ${template.response.parser}`,
					`Schema: ${template.response.schema}`,
					`Policy: ${template.response.policy}`,
				]
			: ["Composition fragment; included by model requests, with no response contract of its own."],
		includes: references.includes,
	};
}
