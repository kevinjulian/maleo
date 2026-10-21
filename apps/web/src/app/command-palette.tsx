import { Input } from "@design-system/components/input.tsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { LibraryType } from "@models/core/routing.ts";

export interface CommandItem {
	id: string;
	section: string;
	title: string;
	subtitle?: string;
	icon: React.ReactNode;
	run: () => void;
}

interface Props {
	onClose: () => void;
	onGoContent: () => void;
	onGoCreate: () => void;
	onGoLibrary: (type: LibraryType) => void;
	onGoVideo: () => void;
	onGoImages: () => void;
	onGoImageLab: () => void;
	onGoSpeech: () => void;
	onGoSpeechLab: () => void;
	/** Present only for an instance owner; members get no God Mode entry. */
	onGoGodMode?: () => void;
}

export function CommandPalette({
	onClose,
	onGoContent,
	onGoCreate,
	onGoLibrary,
	onGoVideo,
	onGoImages,
	onGoImageLab,
	onGoSpeech,
	onGoSpeechLab,
	onGoGodMode,
}: Props) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [focusIdx, setFocusIdx] = useState(0);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const items: CommandItem[] = useMemo(
		() => [
			{
				id: "go:content",
				section: "navigate",
				title: "Open Projects",
				subtitle: "all projects",
				icon: Ic.book(ICON.md),
				run: onGoContent,
			},
			{
				id: "go:create",
				section: "navigate",
				title: "New project",
				subtitle: "start a project",
				icon: Ic.star(ICON.md),
				run: onGoCreate,
			},
			{
				id: "go:references",
				section: "library",
				title: "References",
				subtitle: "images, products, notes",
				icon: Ic.image(ICON.md),
				run: () => onGoLibrary("references"),
			},
			{
				id: "go:voices",
				section: "library",
				title: "Voices",
				subtitle: "voice catalogue",
				icon: Ic.chat(ICON.md),
				run: () => onGoLibrary("voices"),
			},
			{
				id: "go:presets",
				section: "library",
				title: "Project Presets",
				subtitle: "materials plus a video template",
				icon: Ic.star(ICON.md),
				run: () => onGoLibrary("presets"),
			},
			{
				id: "go:materials",
				section: "library",
				title: "Materials",
				subtitle: "story, visual, voice, rules",
				icon: Ic.book(ICON.md),
				run: () => onGoLibrary("materials"),
			},
			{
				id: "go:templates",
				section: "library",
				title: "Video Templates",
				subtitle: "video structure and timing",
				icon: Ic.layers(ICON.md),
				run: () => onGoLibrary("templates"),
			},
			{
				id: "go:elements",
				section: "library",
				title: "Elements",
				subtitle: "placeable timeline building blocks",
				icon: Ic.elements(ICON.md),
				run: () => onGoLibrary("elements"),
			},
			{
				id: "go:video",
				section: "tools",
				title: "Video",
				subtitle: "render pipeline",
				icon: Ic.play(ICON.md),
				run: onGoVideo,
			},
			{
				id: "go:images",
				section: "tools",
				title: "Images",
				subtitle: "every generated image",
				icon: Ic.image(ICON.md),
				run: onGoImages,
			},
			{
				id: "go:imagelab",
				section: "tools",
				title: "Image Lab",
				subtitle: "generate a new image",
				icon: Ic.spark(ICON.md),
				run: onGoImageLab,
			},
			{
				id: "go:speech",
				section: "tools",
				title: "Speech",
				subtitle: "every synthesized clip",
				icon: Ic.chat(ICON.md),
				run: onGoSpeech,
			},
			{
				id: "go:speechlab",
				section: "tools",
				title: "Speech Lab",
				subtitle: "synthesize a new clip",
				icon: Ic.spark(ICON.md),
				run: onGoSpeechLab,
			},
			...(onGoGodMode
				? [
						{
							id: "go:god",
							section: "tools",
							title: "God Mode",
							subtitle: "instance administration and settings",
							icon: Ic.settings(ICON.md),
							run: onGoGodMode,
						},
					]
				: []),
		],
		[
			onGoContent,
			onGoCreate,
			onGoLibrary,
			onGoVideo,
			onGoImages,
			onGoImageLab,
			onGoSpeech,
			onGoSpeechLab,
			onGoGodMode,
		],
	);

	const filtered = useMemo(() => {
		if (!query.trim()) return items;
		const q = query.toLowerCase();
		return items.filter(
			(it) =>
				it.title.toLowerCase().includes(q) ||
				it.subtitle?.toLowerCase().includes(q) ||
				it.section.toLowerCase().includes(q),
		);
	}, [items, query]);

	// Group by section in render
	const sections = useMemo(() => {
		const order: string[] = [];
		const map: Record<string, CommandItem[]> = {};
		for (const it of filtered) {
			if (!(it.section in map)) {
				map[it.section] = [];
				order.push(it.section);
			}
			map[it.section]!.push(it);
		}
		return order.map((s) => ({ section: s, items: map[s]! }));
	}, [filtered]);

	useEffect(() => {
		setFocusIdx(0);
	}, [query]);

	const flatItems = filtered;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setFocusIdx((i) => Math.min(i + 1, flatItems.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setFocusIdx((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				const item = flatItems[focusIdx];
				if (item) item.run();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [flatItems, focusIdx, onClose]);

	return (
		<div
			role="presentation"
			className="palette-overlay"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="palette" role="dialog" aria-label="command palette">
				<Input
					ref={inputRef}
					className="palette-input"
					placeholder="Type a command, search…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="palette-results">
					{flatItems.length === 0 ? (
						<div className="palette-empty">no matches</div>
					) : (
						sections.map((sec) => (
							<div key={sec.section}>
								<div className="palette-section">{sec.section}</div>
								{sec.items.map((it) => {
									const idx = flatItems.indexOf(it);
									const focused = idx === focusIdx;
									return (
										<div
											key={it.id}
											className={`palette-item ${focused ? "focused" : ""}`}
											onMouseEnter={() => setFocusIdx(idx)}
											onClick={() => it.run()}
										>
											<div className="palette-item-icon">{it.icon}</div>
											<div className="palette-item-body">
												<div className="palette-item-title">{it.title}</div>
												{it.subtitle && <div className="palette-item-sub">{it.subtitle}</div>}
											</div>
											{focused && <span className="palette-item-kbd">↵</span>}
										</div>
									);
								})}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
