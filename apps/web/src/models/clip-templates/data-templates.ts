/* Charts and data callouts. `kind: "data"` routes these through the
 * infographic system rather than the text-preset one. */
import type { TemplateItem } from "./types.ts";

export const barChart: TemplateItem = {
	kind: "data",
	type: "bar_chart",
	label: "Bar Chart",
	category: "data",
	intent: "Animated ranking bars",
};

export const lineChart: TemplateItem = {
	kind: "data",
	type: "line_chart",
	label: "Line Chart",
	category: "data",
	intent: "Trend line with points",
};

export const areaChart: TemplateItem = {
	kind: "data",
	type: "area_chart",
	label: "Area Chart",
	category: "data",
	intent: "Filled performance trend",
};

export const pieChart: TemplateItem = {
	kind: "data",
	type: "pie_chart",
	label: "Pie Chart",
	category: "data",
	intent: "Segment share breakdown",
};

export const donutChart: TemplateItem = {
	kind: "data",
	type: "donut_chart",
	label: "Donut Chart",
	category: "data",
	intent: "Status distribution ring",
};

export const progressBars: TemplateItem = {
	kind: "data",
	type: "progress_bars",
	label: "Progress Bars",
	category: "data",
	intent: "Multi-metric progress",
};

export const circularProgress: TemplateItem = {
	kind: "data",
	type: "circular_progress",
	label: "Circular Progress",
	category: "data",
	intent: "KPI progress ring",
};

export const statCounter: TemplateItem = {
	kind: "data",
	type: "stat_reveal",
	label: "Stat Counter",
	category: "data",
	intent: "Animated KPI number",
};

export const comparisonChart: TemplateItem = {
	kind: "data",
	type: "bar_chart",
	label: "Comparison Chart",
	category: "data",
	intent: "Two-column comparison",
	payload: {
		type: "bar_chart",
		title: "Before vs After",
		rows: [
			{ label: "Before", value: 45, color: "#f72585" },
			{ label: "After", value: 87, color: "#4361ee" },
		],
		unit: "%",
	},
};
