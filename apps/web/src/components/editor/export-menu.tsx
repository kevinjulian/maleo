/* The export control: one button with two jobs, and the menu it opens.
 *
 * It came out of the shell's topbar first, because it is the region that passes
 * the ownership test most cleanly — `exportMenuOpen`, `renderInfoOpen`,
 * `rendering`, `renderStatus` and `submitting` are read here and, apart from the
 * button's own disabled state, nowhere else. It subscribes to those from the
 * shell chrome store rather than receiving them, which is the whole point of the
 * store: before it, extracting this region meant five more props on a signature
 * that already had too many.
 *
 * What it still takes as props is what it does not own: the preflight (derived
 * from the document) and the two render actions (owned by the render flow).
 */
import type { JSX, RefObject } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { renderButtonLabel } from "@models/core/cc-helpers.ts";
import { useShellChrome, type ShellChromeStore } from "@stores/shell-chrome-store.ts";
import type { RenderPreflight } from "@models/core/cc-helpers.ts";
import {
	coverageReason,
	type ExportCoverage,
	type ExportSource,
} from "@models/render/export-coverage.ts";
import { useExportCoverage } from "@hooks/editor/use-export-coverage.ts";

export interface ExportMenuProps {
	chrome: ShellChromeStore;
	/** The menu root, for the outside-pointerdown close the render flow installs. */
	menuRef: RefObject<HTMLDivElement | null>;
	preflight: RenderPreflight;
	/** Opens the status modal mid-render, else toggles the menu. */
	onRenderClick: () => void;
	/** Browser export through the Rust renderer. */
	onLocalRender: () => void;
	/** The queued server render. */
	onConfirmRender: () => void;
	onOpenStatus: () => void;
	/** The storyboard export would render, for the Rust coverage check (p2-export E1). */
	readExportSource: () => ExportSource | null;
}

/** What the coverage check says about Rust export, as one line. */
export function coverageLine(coverage: ExportCoverage | null): string | null {
	switch (coverage?.state) {
		case undefined:
			return null;
		case "checking":
			return "Checking Rust renderer coverage…";
		case "eligible":
			return "Rust renderer covers every frame.";
		case "ineligible":
			return `Rust renderer does not cover: ${coverageReason(coverage.entries)}`;
		case "error":
			return `Rust coverage check failed: ${coverage.message}`;
	}
}

export function ExportMenu({
	chrome,
	menuRef,
	preflight,
	onRenderClick,
	onLocalRender,
	onConfirmRender,
	onOpenStatus,
	readExportSource,
}: ExportMenuProps): JSX.Element {
	const rendering = useShellChrome(chrome, "rendering");
	const connection = useShellChrome(chrome, "exportConnection");
	const checking = connection === "checking" || connection === "disconnected";
	const renderStatus = useShellChrome(chrome, "renderStatus");
	const exportMenuOpen = useShellChrome(chrome, "exportMenuOpen");
	const submitting = useShellChrome(chrome, "submitting");
	const checked = useExportCoverage(exportMenuOpen && !rendering && !checking, readExportSource);
	const coverageState = checked?.state;
	const coverage = coverageLine(checked);
	const tone = preflight.blockers.length ? "blocked" : preflight.warnings.length ? "warn" : "ready";
	return (
		<div className="cv-export-menu" ref={menuRef}>
			<Button
				variant="primary"
				size="sm"
				className={rendering ? "cv-render-active" : undefined}
				onClick={rendering || checking ? onOpenStatus : onRenderClick}
				disabled={submitting}
				title={rendering ? "Export in progress — click for status" : "Export video"}
			>
				{checking ? (
					connection === "checking" ? (
						"Checking export…"
					) : (
						"Export status unavailable"
					)
				) : connection === "missing" ? (
					"Export unavailable"
				) : rendering ? (
					<>
						<span className="cv-spin" /> {renderButtonLabel(renderStatus)}
					</>
				) : (
					<>
						{Ic.film(ICON.sm)} <span className="cv-export-label">Export Video</span>
					</>
				)}
			</Button>
			{exportMenuOpen && !rendering && !checking && (
				<div className="cv-export-pop" role="menu">
					<div className={`cv-export-preflight ${tone}`}>
						<div className="cv-export-preflight-h">
							<span>
								{preflight.blockers.length
									? Ic.x(ICON.sm)
									: preflight.warnings.length
										? Ic.spark(ICON.sm)
										: Ic.check(ICON.sm)}
							</span>
							<b>{preflight.summary}</b>
						</div>
						<ul>
							{preflight.blockers.map((item) => (
								<li key={`b:${item}`}>{item}</li>
							))}
							{preflight.warnings.slice(0, 3).map((item) => (
								<li key={`w:${item}`}>{item}</li>
							))}
							{preflight.blockers.length === 0 && preflight.warnings.length === 0 && (
								<li>Preview and timeline have exportable content.</li>
							)}
							{coverage && <li data-export-coverage>{coverage}</li>}
						</ul>
					</div>
					{(renderStatus || connection === "missing") && (
						<button role="menuitem" onClick={onOpenStatus}>
							View last export
						</button>
					)}
					<button
						role="menuitem"
						disabled={preflight.blockers.length > 0 || coverageState !== "eligible"}
						onClick={onLocalRender}
					>
						{Ic.export(ICON.md)}
						<span>
							<b>Browser export</b>
							<em>Rust renderer on this device, saved as MP4; no server queue</em>
						</span>
					</button>
					<button
						role="menuitem"
						disabled={preflight.blockers.length > 0}
						onClick={onConfirmRender}
					>
						{Ic.film(ICON.md)}
						<span>
							<b>Server render</b>
							<em>Production Remotion render queue</em>
						</span>
					</button>
				</div>
			)}
		</div>
	);
}
