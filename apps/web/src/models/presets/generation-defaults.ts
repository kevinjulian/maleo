/* Maleo — Content-First Create · Data, helpers, constants, types */

import {
	type ClipTemplate,
	type InfographicPayload,
	type InfographicStyle,
	type PacingDevices,
} from "@maleo/shared";

export function defaultInfographicPayload(type: InfographicPayload["type"]): InfographicPayload {
	return type === "stat_reveal"
		? { type, title: "Total Revenue", value: "1.2M", suffix: "+23.5% vs last month" }
		: type === "line_chart"
			? {
					type,
					title: "Revenue Over Time",
					unit: "%",
					points: [
						{ label: "Jan", value: 30 },
						{ label: "Feb", value: 45 },
						{ label: "Mar", value: 35 },
						{ label: "Apr", value: 60 },
						{ label: "May", value: 55 },
						{ label: "Jun", value: 75 },
						{ label: "Jul", value: 70 },
						{ label: "Aug", value: 85 },
					],
				}
			: type === "area_chart"
				? {
						type,
						title: "Performance Metrics",
						unit: "%",
						points: [
							{ label: "Mon", value: 20 },
							{ label: "Tue", value: 45 },
							{ label: "Wed", value: 35 },
							{ label: "Thu", value: 60 },
							{ label: "Fri", value: 55 },
							{ label: "Sat", value: 75 },
							{ label: "Sun", value: 70 },
							{ label: "Mon", value: 85 },
							{ label: "Tue", value: 80 },
							{ label: "Wed", value: 95 },
						],
					}
				: type === "pie_chart"
					? {
							type,
							title: "Market Share",
							unit: "%",
							slices: [
								{ label: "Product A", value: 35, color: "#4361ee" },
								{ label: "Product B", value: 25, color: "#7209b7" },
								{ label: "Product C", value: 20, color: "#f72585" },
								{ label: "Product D", value: 12, color: "#4cc9f0" },
								{ label: "Product E", value: 8, color: "#a855f7" },
							],
						}
					: type === "donut_chart"
						? {
								type,
								title: "Project Status",
								centerLabel: "100%",
								unit: "%",
								slices: [
									{ label: "Completed", value: 40, color: "#4361ee" },
									{ label: "In Progress", value: 25, color: "#7209b7" },
									{ label: "Pending", value: 20, color: "#f72585" },
									{ label: "Remaining", value: 15, color: "#4cc9f0" },
								],
							}
						: type === "progress_bars"
							? {
									type,
									title: "Skill Proficiency",
									unit: "%",
									rows: [
										{ label: "React", value: 90, color: "#4361ee" },
										{ label: "TypeScript", value: 85, color: "#7209b7" },
										{ label: "Node.js", value: 75, color: "#f72585" },
										{ label: "Python", value: 60, color: "#4cc9f0" },
										{ label: "Go", value: 45, color: "#a855f7" },
									],
								}
							: type === "circular_progress"
								? { type, title: "Completion", value: 75, label: "Progress", unit: "%" }
								: type === "table_build"
									? {
											type,
											title: "Comparison",
											columns: ["Item", "Ours", "Theirs"],
											rows: [
												["Battery", "30h", "12h"],
												["Warranty", "2 yr", "-"],
											],
											marks: [
												["none", "tick", "cross"],
												["none", "tick", "cross"],
											],
										}
									: type === "price_tag"
										? { type, title: "Offer", price: "$49", compareAt: "$79", dropAnimation: true }
										: type === "social_proof"
											? {
													type,
													title: "Loved by buyers",
													rating: 4.8,
													reviewCount: "2,300",
													soldCount: "12k",
												}
											: type === "urgency"
												? {
														type,
														title: "Selling fast",
														stockCount: 7,
														stockLabel: "left in stock",
														deadlineText: "Sale ends tonight",
													}
												: {
														type: "bar_chart",
														title: "Monthly Performance",
														unit: "%",
														rows: [
															{ label: "Jan", value: 45, color: "#4361ee" },
															{ label: "Feb", value: 78, color: "#7209b7" },
															{ label: "Mar", value: 62, color: "#f72585" },
															{ label: "Apr", value: 91, color: "#4cc9f0" },
															{ label: "May", value: 55, color: "#a855f7" },
															{ label: "Jun", value: 87, color: "#3b82f6" },
														],
													};
}

/** Rebuild a typed payload from a stored template config.
 *
 *  A custom data template persists its payload as `config`, a plain record — the
 *  clip-template schema cannot name `InfographicPayload` because the union lives
 *  in the editor, not in the persisted contract. Readers used to recover it with
 *  `config as unknown as InfographicPayload`, which claims a shape nothing
 *  checked and drops the discriminant on the floor when the stored record is
 *  missing fields the renderer needs.
 *
 *  This layers the stored record over the default for `type`, so every field the
 *  renderer reads is present whether or not the record carried it, and the
 *  discriminant is the one the caller resolved from the registry rather than
 *  whatever the record happens to hold. */
export function infographicPayloadFrom(
	type: InfographicPayload["type"],
	config: ClipTemplate["config"],
): InfographicPayload {
	// SAFETY: `type` is written last, so the result's discriminant is the caller's
	// resolved type, and the spread of `defaultInfographicPayload(type)` supplies
	// every field that variant declares. What the assertion adds is only that the
	// record's extra keys do not belong to the variant — they are carried through
	// unread, exactly as the previous cast carried them.
	return { ...defaultInfographicPayload(type), ...config, type } as InfographicPayload;
}

// A file in the project's media library ("All Media"). Stock/uploads land here
// first; only library assets can be placed on the timeline.

export const DEFAULT_PACING_DEVICES: PacingDevices = {
	chapterPills: false,
	progressBar: false,
	variant: "pill",
};

export const DEFAULT_INFOGRAPHIC_STYLE: InfographicStyle = {
	bgColor: "#080a10",
	bgOpacity: 0.72,
	borderColor: "#ffffff",
	borderOpacity: 0.18,
	borderRadius: 8,
	blur: 10,
};

// Picker seeds for the OPTIONAL style overrides (dataColor/labelColor).
// Undefined on the style means "inherit the accent/fg at render"; the color
// pickers still need a concrete swatch to display before the user overrides.

export const INFOGRAPHIC_PICKER_FALLBACKS = { data: "#ff3e6c", label: "#ffffff" } as const;
