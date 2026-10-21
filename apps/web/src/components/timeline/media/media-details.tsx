import { useRef, useState, type JSX } from "react";
import { mediaCompatibilityReason } from "@maleo/shared";
import { Modal } from "@design-system/components/modal.tsx";
import { ErrorState } from "@design-system/patterns/collection.tsx";
import { Note } from "@design-system/components/note.tsx";
import { assetUrl } from "@api/client.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { Field } from "@design-system/components/field.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Button } from "@design-system/components/button.tsx";
import type { MediaUsage } from "@models/timeline/media-usage.ts";
import type { DisplayItem } from "./media-browser.tsx";

/** Feature-owned facts and native playback inside existing VUI-owned modal. */
export function MediaDetails({
	item,
	asset,
	onRename,
	onReplace,
	usages = [],
	onReveal,
	onClose,
}: {
	item: DisplayItem;
	asset?: MediaAsset;
	onRename?: (label: string) => void;
	onReplace?: (file: File) => void;
	usages?: MediaUsage[];
	onReveal?: (usage: MediaUsage) => void;
	onClose: () => void;
}): JSX.Element {
	const replacementInput = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(asset?.label ?? item.label);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const metadata = asset?.metadata;
	const reason = !item.url
		? "Source file is missing"
		: mediaCompatibilityReason(asset?.compatibility, "preview");
	const fps = metadata?.frameRate;
	const rate = fps?.average ?? fps?.nominal;
	const facts = [
		["Original filename", metadata?.originalFilename ?? "Unknown"],
		["Type", item.kind],
		["Size", metadata ? `${metadata.byteSize.toLocaleString()} bytes` : "Unknown"],
		["Container", metadata?.container ?? "Unknown"],
		["Video codec", metadata?.videoCodec ?? "Unknown"],
		["Audio codec", metadata?.audioCodec ?? "Unknown"],
		[
			"Dimensions",
			metadata?.width && metadata.height ? `${metadata.width} × ${metadata.height}` : "Unknown",
		],
		[
			"Source duration",
			metadata?.duration != null
				? `${metadata.duration.toFixed(3)} seconds`
				: item.dur != null
					? `${item.dur} seconds`
					: "Unknown",
		],
		[
			"Frame rate",
			fps
				? `${fps.mode}${rate ? ` · ${(rate.numerator / rate.denominator).toFixed(3)} fps` : ""}`
				: "Unknown",
		],
		["Source audio", metadata?.hasAudio == null ? "Unknown" : metadata.hasAudio ? "Yes" : "No"],
		["Preview", asset?.compatibility?.preview.status ?? "Unknown"],
		["Production render", asset?.compatibility?.render.status ?? "Unknown"],
	];
	return (
		<Modal title={`Media details: ${item.label}`} width={640} dock onClose={onClose}>
			{asset && onRename && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (name.trim()) onRename(name.trim());
					}}
				>
					<Field>
						<span>Media name</span>
						<Input value={name} maxLength={240} onChange={(event) => setName(event.target.value)} />
					</Field>
					<Button type="submit" disabled={!name.trim() || name.trim() === asset.label}>
						Rename
					</Button>
				</form>
			)}
			{asset && onReplace && (
				<>
					<input
						ref={replacementInput}
						type="file"
						hidden
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) onReplace(file);
						}}
					/>
					<Button onClick={() => replacementInput.current?.click()}>Replace source</Button>
				</>
			)}
			<section aria-label="Media usage">
				<p>Used in {usages.length} locations</p>
				{usages.map((usage) => (
					<Button key={usage.key} variant="ghost" onClick={() => onReveal?.(usage)}>
						{usage.label}
					</Button>
				))}
			</section>
			{reason || failed ? (
				<ErrorState
					inline
					title="Preview unavailable"
					message={reason ?? "Could not read source. Retry playback or replace missing file."}
					onRetry={
						!reason
							? () => {
									setFailed(false);
									setAttempt((value) => value + 1);
								}
							: undefined
					}
				/>
			) : (
				item.url &&
				(item.kind === "image" ? (
					<img
						key={attempt}
						src={assetUrl(item.url)}
						alt={item.label}
						className="tw:w-full tw:max-h-[40dvh] tw:object-contain"
						onError={() => setFailed(true)}
					/>
				) : item.kind === "video" ? (
					<video
						key={attempt}
						src={assetUrl(item.url)}
						aria-label={`Preview ${item.label}`}
						controls
						playsInline
						preload="metadata"
						className="tw:w-full tw:max-h-[40dvh]"
						onError={() => setFailed(true)}
					/>
				) : (
					<audio
						key={attempt}
						src={assetUrl(item.url)}
						aria-label={`Preview ${item.label}`}
						controls
						preload="metadata"
						className="tw:w-full"
						onError={() => setFailed(true)}
					/>
				))
			)}
			{mediaCompatibilityReason(asset?.compatibility, "render") && (
				<Note>
					Production export unavailable: {mediaCompatibilityReason(asset?.compatibility, "render")}.
					Replace source with supported media.
				</Note>
			)}
			<dl className="tw:grid tw:grid-cols-2 tw:gap-2 tw:py-3 tw:text-sm">
				{facts.map(([label, value]) => (
					<div key={label} className="tw:min-w-0">
						<dt className="tw:text-muted-foreground">{label}</dt>
						<dd className="tw:break-words">{value}</dd>
					</div>
				))}
			</dl>
		</Modal>
	);
}
