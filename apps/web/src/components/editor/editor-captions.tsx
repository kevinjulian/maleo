import { useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";

/* The shape and its default live in @maleo/shared: they persist inside
 * storyboard_json and change what is rendered, so the render worker has to be able
 * to name them. Re-exported here so this panel's consumers resolve unchanged. */
export { DEFAULT_CAPTIONS } from "@maleo/shared";
export type { CaptionConfig, CaptionMotion, CaptionPresetKey } from "@maleo/shared";
import type { CaptionConfig, CaptionMotion, CaptionPresetKey } from "@maleo/shared";
import { DEFAULT_CAPTIONS as DEFAULTS } from "@maleo/shared";
import { ToggleGroup, ToggleGroupItem } from "@design-system/components/toggle-group.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Menu, MenuItem } from "@design-system/components/menu.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { TabsRoot, TabsList, TabsTab, TabsPanel } from "@design-system/components/tabs.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import {
	AmountField,
	FieldRow,
	PropertyRow,
	InspectorSection,
} from "@design-system/patterns/inspector.tsx";

const PRESETS: Array<{
	key: CaptionPresetKey;
	label: string;
	patch: Partial<CaptionConfig>;
	swatch: { bg: string; fg: string };
}> = [
	{
		key: "standard",
		label: "Clean",
		patch: {
			style: "Standard",
			fill: "#ffffff",
			activeColor: "#ffd400",
			background: "transparent",
			stroke: "#000000",
			maxWords: 4,
			maxChars: 26,
			motion: "Fade",
		},
		swatch: { bg: "#16161c", fg: "#ffffff" },
	},
	{
		key: "documentary",
		label: "Documentary",
		patch: {
			style: "Karaoke",
			fontSize: 64,
			fill: "#ffffff",
			activeColor: "#f4d06f",
			background: "transparent",
			stroke: "transparent",
			shadowOpacity: 82,
			shadowBlur: 22,
			maxWords: 6,
			maxChars: 38,
			motion: "Fade",
			inactiveOpacity: 70,
		},
		swatch: { bg: "#1e2428", fg: "#f4d06f" },
	},
	{
		key: "tiktokPunch",
		label: "Punch",
		patch: {
			style: "Word pop",
			fontSize: 84,
			fill: "#ffffff",
			activeColor: "#ffd400",
			stroke: "#000000",
			background: "transparent",
			maxWords: 3,
			maxChars: 20,
			motion: "Pop",
			inactiveOpacity: 48,
		},
		swatch: { bg: "#0b0b0f", fg: "#ffd400" },
	},
	{
		key: "karaoke",
		label: "Karaoke",
		patch: {
			style: "Karaoke",
			fill: "#ffffff",
			activeColor: "#38bdf8",
			stroke: "#000000",
			maxWords: 5,
			maxChars: 30,
			motion: "Slide Up",
			inactiveOpacity: 45,
		},
		swatch: { bg: "#101827", fg: "#38bdf8" },
	},
	{
		key: "education",
		label: "Education",
		patch: {
			style: "Standard",
			fontSize: 60,
			fill: "#111827",
			activeColor: "#2563eb",
			background: "#ffffff",
			stroke: "transparent",
			maxWords: 7,
			maxChars: 44,
			maxWidth: 78,
			motion: "Fade",
			inactiveOpacity: 90,
		},
		swatch: { bg: "#ffffff", fg: "#111827" },
	},
	{
		key: "yellow",
		label: "Yellow",
		patch: {
			fill: "#ffd400",
			activeColor: "#ffffff",
			background: "transparent",
			stroke: "#000000",
			motion: "Pop",
		},
		swatch: { bg: "#16161c", fg: "#ffd400" },
	},
	{
		key: "highlight",
		label: "Highlight",
		patch: {
			fill: "#ffffff",
			activeColor: "#ffd400",
			background: "#000000",
			stroke: "transparent",
			motion: "Fade",
		},
		swatch: { bg: "#000000", fg: "#ffffff" },
	},
	{
		key: "blackOnWhite",
		label: "Black/White",
		patch: {
			fill: "#000000",
			activeColor: "#0f766e",
			background: "#ffffff",
			stroke: "transparent",
			motion: "Fade",
		},
		swatch: { bg: "#ffffff", fg: "#000000" },
	},
];

const FONTS = ["Inter", "Poppins", "Montserrat", "Roboto", "Archivo", "Bebas Neue"];
const SIZES = [48, 56, 64, 72, 84, 96, 120];
const WEIGHTS = ["Regular", "Medium", "Bold", "Black"];
const STYLES = ["Standard", "Karaoke", "Word pop", "Typewriter"];
const MOTIONS: CaptionMotion[] = ["None", "Fade", "Pop", "Slide Up"];
const LINES: CaptionConfig["lines"][] = ["Single Line", "Two Lines"];

export interface CaptionPanelTools {
	/** Opens the SRT file picker; the result reports in the panel. */
	importSrt: () => void;
}

interface CaptionsPanelProps {
	transcript?: (tools: CaptionPanelTools) => ReactNode;
	/** Shows the regenerate step; offered from the header menu once cues exist. */
	onRegenerate?: () => void;
	selectedStyle?: {
		value: CaptionConfig;
		onChange: (patch: Partial<CaptionConfig>) => void;
		onReset: () => void;
	};
	value: CaptionConfig;
	onChange: (next: CaptionConfig) => void;
	onClose: () => void;
	/** Import an .srt document; returns a user-facing error message, or null on success. */
	onImportSrt?: (doc: string) => { ok: boolean; message: string };
	cueCount?: number;
	/** Download authored captions as .srt (disabled when the set is empty). */
	onExportSrt?: () => void;
	exportDisabledReason?: string;
}

export function CaptionsPanel({
	value: globalValue,
	onChange: onGlobalChange,
	transcript,
	selectedStyle,
	onClose,

	onImportSrt,
	cueCount = 0,
	onExportSrt,
	exportDisabledReason,
	onRegenerate,
}: CaptionsPanelProps): JSX.Element {
	const [tab, setTab] = useState("transcript");
	const fileInput = useRef<HTMLInputElement>(null);
	const importSrt = (): void => fileInput.current?.click();
	const [styleScope, setStyleScope] = useState("all");
	const useSelected = styleScope === "selected" && selectedStyle;
	const value = useSelected ? useSelected.value : globalValue;
	const patch = (change: Partial<CaptionConfig>): void => {
		if (useSelected) useSelected.onChange(change);
		else onGlobalChange({ ...globalValue, ...change });
	};
	const [srtResult, setSrtResult] = useState<{ ok: boolean; message: string } | null>(null);
	const importSrtFile = (file: File): void => {
		void file
			.text()
			.then((doc) => setSrtResult(onImportSrt?.(doc) ?? null))
			.catch(() => setSrtResult({ ok: false, message: "Cannot read subtitle file." }));
	};
	const set = <K extends keyof CaptionConfig>(k: K, v: CaptionConfig[K]): void => patch({ [k]: v });
	const applyPreset = (p: (typeof PRESETS)[number]): void => patch({ ...p.patch, preset: p.key });

	return (
		<>
			<PanelHeader
				density="tool"
				title="Captions"
				onClose={onClose}
				closeLabel="Hide panel"
				actions={
					(onRegenerate || onImportSrt || onExportSrt) && (
						<Menu
							label="Caption actions"
							triggerClassName="tw:inline-flex tw:items-center tw:justify-center tw:size-[var(--control-h-sm)] tw:rounded-md tw:text-muted-foreground tw:hover:bg-secondary tw:hover:text-foreground tw:pointer-coarse:size-[var(--control-h-touch)]"
							trigger={Ic.more(ICON.sm)}
						>
							{onRegenerate && cueCount > 0 && (
								<MenuItem
									icon={Ic.refresh(ICON.sm)}
									onSelect={() => {
										setTab("transcript");
										onRegenerate();
									}}
								>
									Regenerate…
								</MenuItem>
							)}
							{onImportSrt && (
								<MenuItem icon={Ic.upload(ICON.sm)} onSelect={importSrt}>
									Import SRT…
								</MenuItem>
							)}
							{onExportSrt && (
								<MenuItem
									icon={Ic.download(ICON.sm)}
									disabled={cueCount === 0 || Boolean(exportDisabledReason)}
									onSelect={onExportSrt}
								>
									<span className="tw:flex tw:flex-col">
										Export SRT
										{(cueCount === 0 || exportDisabledReason) && (
											<span className="tw:text-xs tw:text-muted-foreground">
												{exportDisabledReason ?? "No captions to export."}
											</span>
										)}
									</span>
								</MenuItem>
							)}
						</Menu>
					)
				}
			/>
			{onImportSrt && (
				<input
					ref={fileInput}
					type="file"
					accept=".srt"
					hidden
					aria-hidden="true"
					tabIndex={-1}
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) importSrtFile(f);
						e.target.value = "";
					}}
				/>
			)}
			<div className="tl2-panel-body fc-cap">
				<TabsRoot value={tab} onValueChange={(value) => setTab(String(value))}>
					<TabsList variant="bar" aria-label="Caption views">
						<TabsTab value="transcript">Transcript</TabsTab>
						<TabsTab value="style">Style</TabsTab>
					</TabsList>
					<TabsPanel value="transcript">
						{srtResult && (
							<Note
								tone={srtResult.ok ? "muted" : "error"}
								role={srtResult.ok ? "status" : "alert"}
							>
								{srtResult.message}
							</Note>
						)}
						{transcript?.({ importSrt })}
					</TabsPanel>
					<TabsPanel value="style">
						<PropertyRow label="Apply style to" as="div">
							<ToggleGroup
								aria-label="Caption style scope"
								size="sm"
								value={useSelected ? "selected" : "all"}
								onValueChange={setStyleScope}
							>
								<ToggleGroupItem value="all">All captions</ToggleGroupItem>
								<ToggleGroupItem value="selected" disabled={!selectedStyle}>
									This caption
								</ToggleGroupItem>
							</ToggleGroup>
						</PropertyRow>
						{!selectedStyle && <Note tone="muted">Select a caption to style it on its own.</Note>}
						{useSelected && (
							<Button size="sm" onClick={useSelected.onReset}>
								Reset cue style
							</Button>
						)}
						<div className="tw:px-3 tw:py-2">
							<PropertyRow label="Enable captions" as="div">
								<Switch
									aria-label="Enable captions"
									checked={globalValue.enabled}
									onCheckedChange={(checked) =>
										onGlobalChange({ ...globalValue, enabled: checked })
									}
								/>
							</PropertyRow>
						</div>
						{globalValue.enabled && (
							<>
								<InspectorSection title="Presets" collapsible defaultOpen>
									<div className="fc-cap-presets">
										{PRESETS.map((p) => {
											const look = { ...DEFAULTS, ...p.patch };
											return (
												<button
													key={p.key}
													aria-pressed={value.preset === p.key}
													aria-label={`${p.label} preset, ${look.motion} motion`}
													className={`fc-cap-preset ${value.preset === p.key ? "on" : ""}`}
													onClick={() => applyPreset(p)}
												>
													<span
														className="fc-cap-preview"
														style={{ background: p.swatch.bg, color: look.fill }}
													>
														Cap
														<span style={{ color: look.activeColor }}>tion</span>
													</span>
													<span className="fc-cap-presetlbl">
														{p.label} · {look.motion}
													</span>
												</button>
											);
										})}
									</div>
								</InspectorSection>
								<InspectorSection title="Typography & motion" collapsible defaultOpen>
									<PropertyRow label="Font family">
										<Select
											size="xs"
											value={value.fontFamily}
											onValueChange={(e) => set("fontFamily", e)}
											aria-label={"Font family"}
											phoneBreakpoint={860}
											options={[...(FONTS.map((f) => ({ value: f, label: f })) ?? [])]}
										/>
									</PropertyRow>
									<PropertyRow label="Font size">
										<Select
											size="xs"
											value={value.fontSize}
											onValueChange={(e) => set("fontSize", Number(e))}
											aria-label={"Font size"}
											phoneBreakpoint={860}
											options={[
												...(SIZES.map((s) => ({ value: s, label: String(s) + "px" })) ?? []),
											]}
										/>
									</PropertyRow>
									<PropertyRow label="Weight">
										<Select
											size="xs"
											value={value.weight}
											onValueChange={(e) => set("weight", e)}
											aria-label={"Weight"}
											phoneBreakpoint={860}
											options={[...(WEIGHTS.map((w) => ({ value: w, label: w })) ?? [])]}
										/>
									</PropertyRow>
									<PropertyRow label="Italic">
										<Switch
											size="sm"
											checked={value.italic}
											onCheckedChange={(italic) => set("italic", italic)}
										/>
									</PropertyRow>
									<PropertyRow label="All caps">
										<Switch
											size="sm"
											checked={value.allCaps}
											onCheckedChange={(allCaps) => set("allCaps", allCaps)}
										/>
									</PropertyRow>
									<PropertyRow label="Caption style">
										<Select
											size="xs"
											value={value.style}
											onValueChange={(e) => set("style", e)}
											aria-label={"Caption style"}
											phoneBreakpoint={860}
											options={[
												...(STYLES.map((s) => ({
													value: s,
													label:
														s === "Standard" ? "Plain" : s === "Karaoke" ? "Word highlight" : s,
												})) ?? []),
											]}
										/>
									</PropertyRow>
									<PropertyRow label="Motion">
										<Select
											size="xs"
											value={value.motion}
											onValueChange={onSelect(MOTIONS, (motion) => set("motion", motion))}
											aria-label={"Motion"}
											phoneBreakpoint={860}
											options={[...(MOTIONS.map((m) => ({ value: m, label: m })) ?? [])]}
										/>
									</PropertyRow>
								</InspectorSection>
								<InspectorSection title="Layout" collapsible defaultOpen>
									<PropertyRow label="Lines">
										<Select
											size="xs"
											value={value.lines}
											onValueChange={onSelect(LINES, (lines) => set("lines", lines))}
											aria-label={"Lines"}
											phoneBreakpoint={860}
											options={[...(LINES.map((l) => ({ value: l, label: l })) ?? [])]}
										/>
									</PropertyRow>
									<FieldRow label="Placement">
										<AmountField
											label="Vertical position"
											short="Y"
											suffix="%"
											min={0}
											max={100}
											step={1}
											value={value.verticalPosition}
											onChange={(v) => set("verticalPosition", v)}
										/>
										<AmountField
											label="Max width"
											short="W"
											suffix="%"
											min={48}
											max={96}
											step={1}
											value={value.maxWidth}
											onChange={(v) => set("maxWidth", v)}
										/>
									</FieldRow>
								</InspectorSection>
								<InspectorSection title="Colors & shadow" collapsible defaultOpen>
									<ColorRow label="Fill" color={value.fill} onPick={(c) => set("fill", c)} />
									<ColorRow
										label="Active"
										color={value.activeColor}
										onPick={(c) => set("activeColor", c)}
									/>
									<ColorRow label="Stroke" color={value.stroke} onPick={(c) => set("stroke", c)} />
									<ColorRow
										label="Background"
										color={value.background}
										onPick={(c) => set("background", c)}
									/>
									<ColorRow label="Shadow" color={value.shadow} onPick={(c) => set("shadow", c)} />
									<FieldRow label="Shadow size">
										<AmountField
											label="Shadow blur"
											short="Blur"
											suffix="px"
											min={0}
											max={48}
											step={1}
											value={value.shadowBlur}
											onChange={(v) => set("shadowBlur", v)}
										/>
										<AmountField
											label="Shadow distance"
											short="Dist"
											suffix="px"
											min={0}
											max={24}
											step={1}
											value={value.shadowDistance}
											onChange={(v) => set("shadowDistance", v)}
										/>
										<AmountField
											label="Shadow opacity"
											short="α"
											suffix="%"
											min={0}
											max={100}
											step={1}
											value={value.shadowOpacity}
											onChange={(v) => set("shadowOpacity", v)}
										/>
									</FieldRow>
									<FieldRow label="Inactive words">
										<AmountField
											label="Inactive opacity"
											short="α"
											suffix="%"
											min={20}
											max={100}
											step={1}
											value={value.inactiveOpacity}
											onChange={(v) => set("inactiveOpacity", v)}
										/>
									</FieldRow>
								</InspectorSection>
							</>
						)}
					</TabsPanel>
				</TabsRoot>
			</div>
		</>
	);
}

function ColorRow({
	label,
	color,
	onPick,
}: {
	label: string;
	color: string;
	onPick: (c: string) => void;
}): JSX.Element {
	return (
		<PropertyRow label={label} as="div">
			<AlphaColorControl
				display="value"
				label={label}
				value={color}
				fallback="#000000"
				onChange={onPick}
			/>
		</PropertyRow>
	);
}

export default CaptionsPanel;
