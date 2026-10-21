import type { JSX } from "react";
import type { AgentTemplateCatalog, AgentTemplateDefinition } from "@maleo/shared";
import type { TemplateSelection } from "@models/core/routing.ts";
import { templateRecipeRows } from "@models/admin/template-structure.ts";
import { Table, TableScroll } from "@design-system/components/table.tsx";
import { TemplateDefinitionLink } from "./template-definition-link.tsx";

export function TemplateRecipe({
	item,
	catalog,
	selectionFor,
	onSelect,
}: {
	item: AgentTemplateDefinition;
	catalog: AgentTemplateCatalog;
	selectionFor: (item: AgentTemplateDefinition) => TemplateSelection;
	onSelect: (item: AgentTemplateDefinition) => void;
}): JSX.Element | null {
	if (!item.recipe) return null;
	const rows = templateRecipeRows(item.recipe);
	return (
		<>
			<h4>Production recipe</h4>
			<p>Template assembly, not a submitted request. Input values remain unresolved.</p>
			<TableScroll className="template-table-scroll" label="Production recipe table">
				<Table aria-label="Production recipe">
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Block</th>
							<th scope="col">Composition</th>
							<th scope="col">When</th>
							<th scope="col">Fidelity</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(({ position, node, condition }) => {
							const target = catalog.definitions.find((entry) => entry.id === node.definitionId);
							return (
								<tr key={position}>
									<td>{position}</td>
									<td>
										{target ? (
											<TemplateDefinitionLink
												item={target}
												selection={selectionFor(target)}
												onSelect={onSelect}
											/>
										) : (
											node.id.split(":").at(-1)
										)}
									</td>
									<td>
										{node.kind === "fragment"
											? `${node.parts?.length} fixed parts / ${node.values.length} slots`
											: node.kind === "join"
												? `Join with ${JSON.stringify(node.separator)}; ${node.omitEmpty ? "omit" : "keep"} empty blocks`
												: node.kind === "repeat"
													? `Repeat selected items; separator ${JSON.stringify(node.separator)}; empty ${JSON.stringify(node.empty)}`
													: node.kind === "choice"
														? node.children.length === 1
															? "True: include block; false: omit"
															: "Choose true / false block"
														: "Linked recipe"}
									</td>
									<td>{condition}</td>
									<td>{node.provenance.kind}</td>
								</tr>
							);
						})}
					</tbody>
				</Table>
			</TableScroll>
			{rows.some(({ node }) => node.values.length > 0) && (
				<>
					<h4>Interpolation bindings</h4>
					<TableScroll className="template-table-scroll" label="Interpolation bindings table">
						<Table aria-label="Interpolation bindings">
							<thead>
								<tr>
									<th scope="col">Block</th>
									<th scope="col">Slot</th>
									<th scope="col">Binding</th>
									<th scope="col">Resolution</th>
								</tr>
							</thead>
							<tbody>
								{rows.flatMap(({ position, node }) =>
									node.values.map((value, index) => (
										<tr key={`${position}.${index}`}>
											<td>{node.id.split(":").at(-1)}</td>
											<td>{index + 1}</td>
											<td>
												<code>{value}</code>
											</td>
											<td>Unresolved input</td>
										</tr>
									)),
								)}
							</tbody>
						</Table>
					</TableScroll>
				</>
			)}
			<details>
				<summary>Inputs, defaults and transforms</summary>
				<TableScroll className="template-table-scroll" label="Recipe inputs table">
					<Table aria-label="Recipe inputs">
						<thead>
							<tr>
								<th scope="col">Block</th>
								<th scope="col">Input</th>
								<th scope="col">Type</th>
								<th scope="col">Resolution</th>
							</tr>
						</thead>
						<tbody>
							{rows.flatMap(({ position, node }) =>
								node.inputs.map((input, index) => (
									<tr key={`${position}.${index}`}>
										<td>{node.id.split(":").at(-1)}</td>
										<td>
											<code>{input.name}</code>
										</td>
										<td>{input.type}</td>
										<td>Unresolved input</td>
									</tr>
								)),
							)}
						</tbody>
					</Table>
				</TableScroll>
				<TableScroll className="template-table-scroll" label="Recipe transforms table">
					<Table aria-label="Recipe transforms">
						<thead>
							<tr>
								<th scope="col">Block</th>
								<th scope="col">Kind</th>
								<th scope="col">Source</th>
							</tr>
						</thead>
						<tbody>
							{rows.flatMap(({ position, node }) =>
								[
									...node.defaults.map((source) => ({ kind: "Default / omission", source })),
									...node.transforms.map((source) => ({ kind: "Transform", source })),
								].map((value, index) => (
									<tr key={`${position}.${index}`}>
										<td>{node.id.split(":").at(-1)}</td>
										<td>{value.kind}</td>
										<td>
											<code>{value.source}</code>
										</td>
									</tr>
								)),
							)}
						</tbody>
					</Table>
				</TableScroll>
				{item.recipe.binding && (
					<details>
						<summary>Complete binding source</summary>
						<pre>{item.recipe.binding}</pre>
					</details>
				)}
			</details>
		</>
	);
}
