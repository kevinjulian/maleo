/* Motion design intent: which primitive layers a moment shows and how they change.
 * Timing, easing and springs are not asked for; the motion compiler owns them. */
import { truthy, type PromptTemplate } from "@maleo/shared";

export const MOTION_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:content:authorMotionIntent",
		description:
			"One moment of motion design as primitive layers, roles and states; the compiler adds timing.",
		body: [
			"You are a motion designer. Design ONE moment of on-screen motion graphics as JSON, built only from plain text and these shapes: shape-rect, shape-circle, shape-triangle, shape-star, shape-cross.\n\nYou decide WHAT appears and HOW it is arranged. Do not write durations, easings or delays: code derives every curve from the role and class you give each layer.\n\nMoment: ",
			{ type: "slot", path: "presentation" },
			" beat, ",
			{ type: "slot", path: "spanSec" },
			" seconds, ",
			{ type: "slot", path: "aspect" },
			" frame.\nOn-screen text (quote it exactly; split it across layers if useful, but add no words, numbers or claims):\n",
			{ type: "slot", path: "sourceText", filters: ["trim"] },
			"",
			{
				type: "when",
				if: truthy("purpose"),
				then: ["\nEditorial purpose: ", { type: "slot", path: "purpose" }],
			},
			"",
			{
				type: "when",
				if: truthy("visualConcept"),
				then: [
					"\nVisual concept of the beat: ",
					{ type: "slot", path: "visualConcept", filters: ["collapseWs", "trim"] },
				],
			},
			"",
			{
				type: "when",
				if: truthy("visualStyle"),
				then: [
					"\nProject visual style (match its palette): ",
					{ type: "slot", path: "visualStyle", filters: ["collapseWs", "trim"] },
				],
			},
			"\n\nRules:\n- Layers paint in list order: the first is at the back. Put shapes behind the text they frame.\n- `box` is the layer's resting place in percent of the frame (xPct, yPct = top-left corner).\n- `role`: at most ONE `hero` moves in a state and it leads that state; other moving layers are `secondary`; `ambient` layers drift quietly. Every state must move at least one layer.\n- Each change names its layer in the `layer` field.\n- `class`: headline, body, label (text); container (a shape that frames text), accent (a small decorative shape), indicator (an underline or marker that travels between items).\n- A layer with `enter` is hidden until that state; `from` is the direction it moves: up, down, left, right, scale, fade, grow-x, grow-y. `exit.to` uses the same words.\n- A state's `changes` move a visible layer to new values (xPct, yPct, widthPct, heightPct, scale, rotationDeg, opacity; `fill` on text only).\n- Colours are #rrggbb. Leave a shape's fill out to use the brand accent.\n- Keep text inside the frame and readable: at least 40 px for body text, 72 px or more for a headline.\n- Avoid: gradients, glow, floating particles, every layer fading in at once, centring everything, text that moves while it is being read.\n- At most 12 layers and 8 states. The first state is usually at 0.",
			{
				type: "when",
				if: truthy("error"),
				then: [
					"\n\nYour previous answer was refused: ",
					{ type: "slot", path: "error" },
					". Fix exactly that.",
				],
			},
			"\n\nExample of the shape (a different moment; do not copy its text or layout):\n",
			{ type: "slot", path: "example" },
			"\n\nRespond with ONLY compact JSON of that shape. No markdown, no commentary.",
		],
		response: {
			parser: "json.fenced",
			schema: "motionIntent",
			policy: "motion.retryThenPlainText",
		},
	},
];
