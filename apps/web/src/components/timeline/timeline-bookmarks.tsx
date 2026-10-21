import { useState } from "react";
import { bookmarkSchema, type Bookmark } from "@maleo/shared";
import { Modal } from "@design-system/components/modal.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Toolbar, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { removeBookmark, upsertBookmark } from "@maleo/shared/editor";

export function BookmarkRuler({
	bookmarks,
	total,
	pxPerSec,
	onOpen,
	onSeek,
}: {
	bookmarks: Bookmark[];
	total: number;
	pxPerSec: number;
	onOpen: (id: string) => void;
	onSeek: (time: number) => void;
}) {
	return (
		<div className="tl2-bookmark-band" aria-label="Timeline bookmarks">
			{bookmarks
				.filter((b) => b.timeSec <= total)
				.map((b) => (
					<IconButton
						key={b.id}
						size="xs"
						title={`${b.label} · ${b.timeSec}s; open to edit`}
						aria-label={`Bookmark ${b.label}`}
						style={{
							position: "absolute",
							left: b.timeSec * pxPerSec,
						}}
						onClick={() => {
							onSeek(b.timeSec);
							onOpen(b.id);
						}}
					>
						{Ic.book(ICON.sm)}
					</IconButton>
				))}
		</div>
	);
}

function BookmarkForm({
	bookmark,
	total,
	onSave,
}: {
	bookmark: Bookmark;
	total: number;
	onSave: (bookmark: Bookmark) => void;
}) {
	const [label, setLabel] = useState(bookmark.label);
	const [time, setTime] = useState(String(bookmark.timeSec));
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const parsed = bookmarkSchema.safeParse({ id: bookmark.id, label, timeSec: Number(time) });
				if (!parsed.success || !time.trim() || Number(time) > total) {
					setError(`Enter a name and time between 0 and ${total} seconds.`);
					return;
				}
				onSave(parsed.data);
				setError(null);
			}}
		>
			<PropertyRow label="Bookmark name">
				<Input value={label} maxLength={160} required onChange={(e) => setLabel(e.target.value)} />
			</PropertyRow>
			<PropertyRow label="Time (seconds)">
				<Input
					type="number"
					min={0}
					max={Math.max(total, bookmark.timeSec)}
					step="any"
					required
					value={time}
					onChange={(e) => setTime(e.target.value)}
				/>
			</PropertyRow>
			{bookmark.timeSec > total && (
				<Note role="status">
					Outside shortened timeline. Original time retained; move bookmark into range or remove it.
				</Note>
			)}
			{error && <Note role="alert">{error}</Note>}
			<Button type="submit" size="sm" variant="primary">
				Save bookmark
			</Button>
		</form>
	);
}

export function BookmarksDialog({
	store,
	writers,
	total,
	playhead,
	initialId,
	onClose,
	onSeek,
}: {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	total: number;
	playhead: number;
	initialId: string | null;
	onClose: () => void;
	onSeek: (time: number) => void;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const bookmarks = [...(doc.bookmarks ?? [])].sort((a, b) => a.timeSec - b.timeSec);
	const [editing, setEditing] = useState<string | null>(initialId);
	const selected = bookmarks.find((b) => b.id === editing);
	return (
		<Modal
			title="Bookmarks"
			sub="Named points stay fixed when scenes change."
			dock
			onClose={onClose}
		>
			<ToolbarGroup label="Bookmark actions">
				<Button
					size="sm"
					onClick={() => {
						const bookmark = {
							id: crypto.randomUUID(),
							label: `Bookmark ${bookmarks.length + 1}`,
							timeSec: Math.max(0, Math.min(total, playhead)),
						};
						writers.apply(upsertBookmark(bookmark));
						setEditing(bookmark.id);
					}}
				>
					Add at playhead
				</Button>
			</ToolbarGroup>
			{bookmarks.length === 0 && <Note>No bookmarks yet.</Note>}
			{bookmarks.map((b) => (
				<div key={b.id}>
					<Toolbar label={b.label}>
						<Button
							size="sm"
							disabled={b.timeSec > total}
							className="tw:max-w-full"
							onClick={() => {
								onSeek(b.timeSec);
								onClose();
							}}
							aria-label={`Go to ${b.label}`}
						>
							<span className="tw:min-w-0 tw:truncate">
								{b.label} · {b.timeSec}s
							</span>
						</Button>
						<Button size="sm" aria-label={`Edit ${b.label}`} onClick={() => setEditing(b.id)}>
							Edit
						</Button>
						<Button
							size="sm"
							variant="danger"
							aria-label={`Remove ${b.label}`}
							onClick={() => {
								writers.apply(removeBookmark(b.id));
								if (editing === b.id) setEditing(null);
							}}
						>
							Remove
						</Button>
					</Toolbar>
					{b.timeSec > total && (
						<Note role="status">{b.label}: outside shortened timeline. Time retained.</Note>
					)}
				</div>
			))}
			{selected && (
				<BookmarkForm
					key={selected.id}
					bookmark={selected}
					total={total}
					onSave={(bookmark) => {
						writers.apply(upsertBookmark(bookmark));
						setEditing(null);
					}}
				/>
			)}
		</Modal>
	);
}
