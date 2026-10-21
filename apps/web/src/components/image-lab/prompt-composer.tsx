/* The sticky composer: attached references, aspect, prompt, send.
 *
 * The reference chips and the picker popover live here rather than in the page
 * because they are anchored to the composer — the popover is positioned
 * against it, so the two cannot be separated without changing the layout.
 */
import { Select, onSelect } from "@design-system/components/select.tsx";
import React from "react";
import type { JSX, RefObject } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import {
	ASPECTS,
	canGenerate,
	MAX_REFS,
	type Aspect,
	type Health,
} from "@models/image-lab/image-job.ts";
import type { ReferencePickerModel } from "@hooks/image-lab/use-reference-picker.ts";
import type { ImageProviderStatusModel } from "@hooks/settings/use-image-provider-status.ts";
import {
	effectiveImageProviderLabel,
	imageProviderStatusMessage,
} from "@models/settings/image-provider.ts";
import { PromptComposer } from "@design-system/patterns/prompt-composer.tsx";

export function ImagePromptComposer({
	refs,
	prompt,
	onPrompt,
	aspect,
	onAspect,
	imageProvider,
	busy,
	health,
	workspace,
	inputRef,
	onSubmit,
}: {
	refs: ReferencePickerModel;
	prompt: string;
	onPrompt: (v: string) => void;
	aspect: Aspect;
	onAspect: (v: Aspect) => void;
	imageProvider: ImageProviderStatusModel;
	busy: boolean;
	health: Health | null;
	workspace: string;
	inputRef: RefObject<HTMLTextAreaElement | null>;
	onSubmit: () => void;
}): JSX.Element {
	const blocked = !canGenerate({ health, workspace, prompt, busy });
	const providerLabel = imageProvider.status
		? effectiveImageProviderLabel(imageProvider.status)
		: "Provider";
	const toggleRefs = (): void => {
		refs.setOpen(!refs.open);
	};

	/* Escape closes whichever popover is open and puts focus back in the prompt,
	 * so the draft is where the next keystroke goes. Neither popover could be
	 * closed from the keyboard before. */
	const closePopovers = (e: React.KeyboardEvent): void => {
		if (e.key !== "Escape" || !refs.open) return;
		e.preventDefault();
		refs.setOpen(false);
		inputRef.current?.focus();
	};

	return (
		<div role="presentation" className="imagelab-composer-wrap" onKeyDown={closePopovers}>
			{(refs.selectedRefs.length > 0 || refs.open) && (
				<div className="imagelab-ref-chips">
					{refs.selectedRefs.map((r) => (
						<span key={r.id} className="imagelab-ref-chip">
							<img src={r.imageUrl} alt={r.label} />
							{r.label}
							<IconButton
								size="micro"
								aria-label={`Remove ${r.label}`}
								title="Remove reference"
								onClick={() => refs.toggle(r.id)}
							>
								{Ic.x(ICON.xs)}
							</IconButton>
						</span>
					))}
				</div>
			)}

			{refs.open && (
				<div className="imagelab-ref-popover">
					<div className="imagelab-ref-popover-head">
						<span>
							Attach references ({refs.selectedRefIds.length}/{MAX_REFS})
						</span>
						<IconButton
							size="xs"
							aria-label="Close references"
							onClick={() => {
								refs.setOpen(false);
								inputRef.current?.focus();
							}}
						>
							{Ic.x(ICON.md)}
						</IconButton>
					</div>
					<div className="imagelab-ref-popover-body">
						{refs.catalogueImages.length === 0 ? (
							<div className="imagelab-ref-empty">
								No reference images yet — add some under Library › References.
							</div>
						) : (
							<div className="imagelab-ref-grid">
								{refs.catalogueImages.map((r) => {
									const on = refs.selectedRefIds.includes(r.id);
									return (
										<button
											key={r.id}
											onClick={() => refs.toggle(r.id)}
											title={r.label}
											className={`imagelab-ref-tile${on ? " selected" : ""}`}
											style={{ opacity: !on && refs.selectedRefIds.length >= MAX_REFS ? 0.4 : 1 }}
										>
											<div className="imagelab-ref-thumb">
												<img src={r.imageUrl} alt={r.label} loading="lazy" />
											</div>
											<span>{r.label}</span>
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>
			)}

			<PromptComposer
				elevated
				label="Image prompt"
				value={prompt}
				onValueChange={onPrompt}
				onSubmit={onSubmit}
				canSubmit={!blocked}
				busy={busy}
				disabled={busy || !workspace}
				placeholder={workspace ? "Describe the scene..." : "Select a workspace first"}
				submitLabel="Generate image"
				busyLabel="Generating image"
				inputRef={inputRef}
				tools={
					<>
						<button
							onClick={toggleRefs}
							title="Attach reference images"
							aria-expanded={refs.open}
							className={`imagelab-tool-btn${refs.open || refs.selectedRefs.length > 0 ? " active" : ""}`}
						>
							{Ic.image(ICON.lg)}
							<span>{refs.selectedRefs.length ? `${refs.selectedRefs.length} refs` : "Refs"}</span>
						</button>
						<span
							className="imagelab-provider-trigger"
							title="Provider managed by an instance owner in God Mode"
						>
							<b>{providerLabel}</b>
						</span>
						<Select
							aria-label="Aspect ratio"
							width="auto"
							value={aspect}
							onValueChange={onSelect(ASPECTS, onAspect)}
							options={ASPECTS.map((value) => ({ value, label: value }))}
							trigger={
								<button type="button" className="imagelab-ratio-trigger">
									<b>{aspect}</b>
								</button>
							}
						/>
					</>
				}
			/>
			{(imageProvider.busy ||
				imageProvider.error ||
				!imageProvider.status ||
				imageProvider.status.selection_error ||
				!imageProvider.status.worker_configured) && (
				<div className="imagelab-provider-message" aria-live="polite">
					{imageProviderStatusMessage({
						status: imageProvider.status,
						busy: imageProvider.busy,
						error: imageProvider.error,
					})}
					{imageProvider.status && !imageProvider.status.worker_configured
						? " Media worker is not configured."
						: ""}
				</div>
			)}
			{!health?.ok && health !== null && (
				<div className="imagelab-service-warning">
					service {health.configured ? "down" : "not configured"}
				</div>
			)}
		</div>
	);
}
