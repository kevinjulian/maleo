/* The locked-constraint block every planning and authoring prompt carries. */
import { joinPresent, type Expression, type PromptTemplate } from "@maleo/shared";

const visual: Expression = { not: { empty: "locked.visual" } };
const references: Expression = { not: { empty: "locked.references" } };
const rules: Expression = { not: { empty: "locked.rules" } };

export const CONSTRAINT_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:constraints:lockedConstraintBlock",
		description:
			"Authored Visual material, locked references and Rules every written look or shot must fit.",
		body: [
			{
				type: "when",
				if: { or: [visual, references, rules] },
				then: [
					"\n\n",
					...joinPresent("\n\n", [
						{
							when: visual,
							nodes: [
								"Visual direction (authored, must be honoured):\n",
								{ type: "slot", path: "locked.visual", filters: ["trim"] },
								"",
							],
						},
						{
							when: references,
							nodes: [
								"Locked subject references — the style must suit these, not replace them:\n",
								{
									type: "each",
									path: "locked.references",
									as: "ref",
									sep: "\n",
									template: [
										"- ",
										{ type: "slot", path: "ref.label" },
										"",
										{
											type: "when",
											if: { not: { empty: "ref.description" } },
											then: [
												": ",
												{ type: "slot", path: "ref.description", filters: ["trim"] },
												"",
											],
										},
										"",
									],
								},
								"",
							],
						},
						{
							when: rules,
							nodes: [
								"Hard constraints (must be obeyed):\n",
								{ type: "slot", path: "locked.rules", filters: ["trim"] },
								"",
							],
						},
					]),
					"\n\nThese are fixed. Everything you write must FIT them. Do not introduce a medium, subject class, or setting that contradicts them.",
				],
			},
		],
	},
];
