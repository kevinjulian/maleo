/* The @-mention textarea. The matching rules it drives —  what counts as a
 * trigger, which references match, which ids the text still justifies — are
 * pure and live in models/references/mention-matching.ts. */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, JSX, KeyboardEvent } from "react";
import type { RefImage } from "@maleo/shared";
import {
	addMentionRefId,
	dedupeRefs,
	detectMentionTrigger,
	filterMentionRefs,
	insertMentionText,
	pruneMentionRefIds,
	refKind,
	type MentionTrigger,
} from "@models/references/mention-matching.ts";
import { Textarea } from "@design-system/components/input.tsx";
import { isComposingKey } from "@models/core/keys.ts";

interface MentionTextareaProps {
	className?: string;
	rows?: number;
	value: string;
	selectedRefIds?: string[];
	refs: RefImage[];
	placeholder?: string;
	onChange: (value: string) => void;
	/** Absent where the field has no id store to keep in sync — the mentions are
	 *  then a spelling aid for names the prose goes on to use, and the text is the
	 *  only thing that travels. Present everywhere the ids are actually bound. */
	onRefIdsChange?: (ids: string[]) => void;
}

export function MentionTextarea({
	className,
	rows,
	value,
	selectedRefIds,
	refs,
	placeholder,
	onChange,
	onRefIdsChange,
}: MentionTextareaProps): JSX.Element {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
	const [active, setActive] = useState(0);
	const library = useMemo(() => dedupeRefs(refs), [refs]);
	const matches = useMemo(
		() => (trigger ? filterMentionRefs(library, trigger.query) : []),
		[library, trigger],
	);
	const groups = useMemo(() => {
		const out = new Map<string, RefImage[]>();
		for (const ref of matches) {
			const kind = refKind(ref);
			out.set(kind, [...(out.get(kind) ?? []), ref]);
		}
		return Array.from(out.entries());
	}, [matches]);

	const syncTrigger = useCallback((text: string, cursor: number): void => {
		const next = detectMentionTrigger(text, cursor);
		setTrigger(next);
		setActive(0);
	}, []);

	const choose = useCallback(
		(ref: RefImage): void => {
			if (!trigger) return;
			const next = insertMentionText(value, trigger, ref);
			onChange(next.value);
			onRefIdsChange?.(addMentionRefId(selectedRefIds, ref.id));
			setTrigger(null);
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) return;
				textarea.focus();
				textarea.selectionStart = next.cursor;
				textarea.selectionEnd = next.cursor;
			});
		},
		[onChange, onRefIdsChange, selectedRefIds, trigger, value],
	);

	const onInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
		const text = event.target.value;
		onChange(text);
		if (onRefIdsChange) {
			const prunedRefIds = pruneMentionRefIds(selectedRefIds, text, library);
			if ((selectedRefIds?.join("\u0000") ?? "") !== prunedRefIds.join("\u0000"))
				onRefIdsChange(prunedRefIds);
		}
		syncTrigger(text, event.target.selectionStart ?? text.length);
	};

	const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (!trigger) return;
		if (event.key === "Escape") {
			event.preventDefault();
			setTrigger(null);
			return;
		}
		if (!matches.length) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((idx) => (idx + 1) % matches.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((idx) => (idx - 1 + matches.length) % matches.length);
		} else if ((event.key === "Enter" || event.key === "Tab") && !isComposingKey(event)) {
			event.preventDefault();
			const ref = matches[active];
			if (ref) choose(ref);
		}
	};

	return (
		<div className="tl2-mention-wrap">
			<Textarea
				ref={textareaRef}
				className={className}
				rows={rows}
				value={value}
				placeholder={placeholder}
				onChange={onInput}
				onKeyDown={onKey}
				onSelect={(event) => syncTrigger(value, event.currentTarget.selectionStart ?? value.length)}
				onBlur={() => window.setTimeout(() => setTrigger(null), 140)}
			/>
			{trigger && (
				<div className="tl2-mention-pop" role="listbox">
					{matches.length ? (
						groups.map(([kind, items]) => (
							<div key={kind} className="tl2-mention-group">
								<div className="tl2-mention-group-h">{kind}</div>
								{items.map((ref) => {
									const idx = matches.findIndex((item) => item.id === ref.id);
									return (
										<button
											key={ref.id}
											type="button"
											className={`tl2-mention-item ${idx === active ? "active" : ""}`}
											role="option"
											aria-selected={idx === active}
											onMouseDown={(event) => {
												event.preventDefault();
												choose(ref);
											}}
											onMouseEnter={() => setActive(idx)}
										>
											{ref.imageUrl ? (
												<img className="tl2-mention-thumb" src={ref.imageUrl} alt="" />
											) : (
												<span className="tl2-mention-thumb empty" />
											)}
											<span className="tl2-mention-label">{ref.label || ref.id}</span>
											<span className="tl2-mention-kind">{refKind(ref)}</span>
										</button>
									);
								})}
							</div>
						))
					) : (
						<div className="tl2-mention-empty">No matching references</div>
					)}
				</div>
			)}
		</div>
	);
}
