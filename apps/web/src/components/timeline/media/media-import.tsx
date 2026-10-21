import { useRef, type JSX, type ReactNode } from "react";
import { SUPPORTED_MEDIA_IMPORT_EXTENSIONS } from "@maleo/shared";
import { Toolbar, ToolbarAction } from "@design-system/patterns/toolbar.tsx";
import { ErrorState, LoadingState } from "@design-system/patterns/collection.tsx";
import { MediaGrid } from "@design-system/patterns/media.tsx";
import { UploadCard } from "./upload-card.tsx";
import type { MediaImportControls } from "@hooks/editor/use-media-import.ts";

const ACCEPT = Object.values(SUPPORTED_MEDIA_IMPORT_EXTENSIONS)
	.flat()
	.map((extension) => `.${extension}`)
	.join(",");
export function MediaImport({
	controls,
	layout = "grid",
	children,
}: {
	controls: MediaImportControls;
	layout?: "grid" | "list";
	children?: ReactNode;
}): JSX.Element {
	const picker = useRef<HTMLInputElement>(null);
	// The failed card a picker choice replaces, when the picker was opened from one.
	const replacing = useRef<string | null>(null);
	const choose = (files: File[]): void => {
		const key = replacing.current;
		replacing.current = null;
		// A pending asset keeps its identity and clips: its file is chosen again, not imported anew.
		if (key && files[0] && controls.rows.find((row) => row.key === key)?.pending) {
			controls.chooseAgain(key, files[0]);
			return;
		}
		if (key && files.length) controls.dismiss(key);
		if (files.length) controls.enqueue(files);
	};
	// Ready files join the project's media as real assets; a ready card stays only to carry a placement notice.
	// A pending file's state is on its own asset card; only files with no asset yet are listed here.
	const uploads = controls.rows.filter(
		(row) =>
			!row.pending && row.status !== "cancelled" && (row.status !== "ready" || Boolean(row.error)),
	);
	return (
		<section aria-label="Import files">
			<Toolbar label="Import media">
				{children}
				<ToolbarAction
					label="Import files"
					hint="Choose files or drop them into Media"
					disabled={!controls.readiness?.available}
					onAction={() => picker.current?.click()}
				>
					Import files
				</ToolbarAction>
			</Toolbar>
			<input
				ref={picker}
				type="file"
				multiple
				accept={ACCEPT}
				aria-label="Choose media files"
				hidden
				onChange={(event) => {
					choose(Array.from(event.currentTarget.files ?? []));
					event.currentTarget.value = "";
				}}
			/>
			{!controls.readiness ? (
				<LoadingState label="Checking file import availability" />
			) : !controls.readiness.available ? (
				<ErrorState
					inline
					title="File import unavailable"
					message={controls.readiness.reason}
					onRetry={controls.refresh}
				/>
			) : null}
			{controls.error && (
				<ErrorState inline title="Could not import files" message={controls.error} />
			)}
			{uploads.length > 0 && (
				<section className="fc-media-sec" aria-label="Uploading files">
					<h4 className="fc-media-sec-h">
						Uploading<span>{uploads.length}</span>
					</h4>
					<MediaGrid
						label="Files being imported"
						layout={layout}
						min={72}
						density="compact"
						className="fc-mediagrid"
					>
						{uploads.map((row) => (
							<UploadCard
								key={row.key}
								row={row}
								layout={layout}
								onRetry={controls.retry}
								onChooseAgain={(key) => {
									replacing.current = key;
									picker.current?.click();
								}}
								onDismiss={controls.dismiss}
							/>
						))}
					</MediaGrid>
				</section>
			)}
		</section>
	);
}
