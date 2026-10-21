/* Maleo — Content-First Create · 3-panel Scene Studio (video + image) */
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	FRAME_CENTER,
	Frame,
	FrameAction,
	FrameActions,
	FrameBadge,
} from "@design-system/components/frame.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { ReferenceLibrary, SceneCastPicker, VoicePicker } from "./references.tsx";
import { useTtsStatus } from "@hooks/timeline/use-tts-status.ts";
import { aspectOf, fmtMMSS } from "@models/core/measures.ts";
import { roleOfRef } from "@models/references/reference-vocabulary.ts";
import { STUDIO_SHOTS, STUDIO_MOVES, STUDIO_TRANSITIONS } from "@models/timeline/editor-media.ts";
import { mintEntityKey, SLIDE_KEY_PREFIX } from "@maleo/shared";
import type {
	Speaker,
	Config,
	ContentType,
	ProjectSelection,
	RefImage,
	RefsState,
	CatalogueProduct,
	ProjectMaterials,
} from "@maleo/shared";
import { generateSceneImage } from "@api/media.ts";
import { StoryboardView } from "./storyboard-export.tsx";
import { resolveSceneRefs, type ResolvedSceneRefs } from "@hooks/timeline/use-scene-refs.ts";
import { Button } from "@design-system/components/button.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { capOf, isScene, isSlide, type StudioItem } from "./studio-item.ts";
import { DurationField } from "./studio-duration-field.tsx";
import { SceneBoard, SceneList } from "./studio-scene-views.tsx";
import { StudioStrip } from "./studio-strip.tsx";

type ToggleCat = "image" | "voice" | "note";
type ToggleKey = "refIds" | "voiceIds" | "noteIds";

/** One of the three reference lists. Only a scene casts voices. */
const listOf = (item: StudioItem, key: ToggleKey): string[] =>
	(key === "voiceIds" ? (isScene(item) ? item.voiceIds : undefined) : item[key]) ?? [];

// Blueprint story beats (Video Director) — the narrative role of a scene.
const STORY_BEATS = ["hook", "setup", "conflict", "twist", "resolution", "cta"] as const;

interface SceneStudioProps {
	type: ContentType;
	config: Config;
	refs: RefsState;
	setRefs: Dispatch<SetStateAction<RefsState>>;
	/** The reference pool: workspace library + this project's roster. */
	pool: RefImage[];
	setPool: Dispatch<SetStateAction<RefImage[]>>;
	products: CatalogueProduct[];
	projectId: string | null;
	/** Tier 2 — the project's selected entities. A scene casts from these. */
	projectSelection: ProjectSelection;
	projectMaterials?: ProjectMaterials | null;
	onToggleProjectSelection: (id: string) => void;
	onSetPrimary?: (id: string, next: boolean) => void;
	onDeleteRef: (id: string) => Promise<boolean>;
	items: StudioItem[];
	setItems: Dispatch<SetStateAction<StudioItem[]>>;
}
export function SceneStudio({
	type,
	config,
	refs,
	setRefs,
	pool,
	setPool,
	products,
	projectId,
	projectSelection,
	projectMaterials,
	onToggleProjectSelection,
	onSetPrimary,
	onDeleteRef,
	items,
	setItems,
}: SceneStudioProps): JSX.Element | null {
	const isVideo = type === "video";
	// Catalogue for the scene voice picker's audition control. The picker resolves
	// a Speaker through it and shows no control when nothing matches. Provider
	// choice lives in Project Settings, not here, so this takes the workspace
	// default rather than inventing a second place to pick one.
	const { ttsVoiceOptions } = useTtsStatus(undefined);
	const [active, setActive] = useState<number | undefined>(items[0]?.id);
	const [gen, setGen] = useState<Record<number, boolean>>({});
	// End-frame generation is tracked separately so the start frame and the
	// optional end frame can shimmer independently in the editor.
	const [genEnd, setGenEnd] = useState<Record<number, boolean>>({});
	const [genErr, setGenErr] = useState<string | null>(null);
	const [view, setView] = useState<"studio" | "board" | "list" | "storyboard">("studio");

	useEffect(() => {
		if (!items.find((i) => i.id === active)) setActive(items[0]?.id);
	}, [items]);

	const scene = items.find((i) => i.id === active) || items[0];
	const aspect = aspectOf(config.format || (isVideo ? "9:16" : "1:1"));
	const idx = items.findIndex((i) => i.id === (scene && scene.id));

	const upd = (id: number, f: string, v: unknown): void =>
		setItems((ss) => ss.map((s) => (s.id === id ? { ...s, [f]: v } : s)));

	/* Which references feed this item's generation — the project's selection
	 * (unless the item opts out) plus its own cast, defaulted by roster size and
	 * capped, resolved by the one rule in @maleo/shared. This surface used to
	 * carry a copy that read the legacy per-ref `default` pin flag instead of the
	 * project selection, so selecting a reference did nothing here while a pinned
	 * flag applied everywhere. */
	const resolveFor = (item: StudioItem): ResolvedSceneRefs =>
		resolveSceneRefs(pool, projectSelection, item);
	const refsFor = (item: StudioItem): RefImage[] => resolveFor(item).refs;
	// The count on a card has to be the resolved, capped set — otherwise the number
	// describes a different set than the render produces.
	const refCountFor = (item: StudioItem): number => refsFor(item).length;
	const characterDesc = (item: StudioItem): string | undefined =>
		refsFor(item)
			.filter((r) => roleOfRef(r) === "character")
			.map((r) => r.description)
			.filter(Boolean)
			.join("; ") || undefined;

	// slot "start" generates the first frame (scene.src). slot "end" generates the
	// optional last frame (scene.endSrc) the image-to-video clip animates toward —
	// its prompt is nudged toward the scene's END state so the two frames differ.
	const genOne = async (item: StudioItem, slot: "start" | "end" = "start"): Promise<void> => {
		const setter = slot === "end" ? setGenEnd : setGen;
		setter((g) => ({ ...g, [item.id]: true }));
		try {
			// One narrowing for the whole call: null for a slide, so every scene-only
			// field below reads off the narrowed value rather than asserting the arm.
			const asScene = isScene(item) ? item : null;
			const endHint =
				slot === "end" && asScene
					? ` Final frame at the end of the shot, after the action completes: ${asScene.action || "the motion has finished"}.`
					: "";
			const url = await generateSceneImage({
				projectId,
				source: "clip",
				visual: (item.vis || (asScene ? asScene.name : capOf(item)) || "product scene") + endHint,
				aspect: config.format,
				refs: refsFor(item),
				sceneName: asScene ? asScene.name : isSlide(item) ? item.name : undefined,
				action: asScene?.action,
				shotType: asScene?.shot,
				movement: asScene?.move,
				tone: refs.style.tone,
				colors: refs.style.palette,
				target: config.audience,
				characterDescription: characterDesc(item),
			});
			if (slot === "end") {
				upd(item.id, "endSrc", url);
			} else {
				upd(item.id, "src", url);
				upd(item.id, "img", true);
			}
		} catch (err) {
			setGenErr(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setter((g) => ({ ...g, [item.id]: false }));
		}
	};
	const genFrame = (id: number, slot: "start" | "end" = "start"): void => {
		const item = items.find((s) => s.id === id);
		if (item) void genOne(item, slot);
	};
	const clearEndFrame = (id: number): void => {
		upd(id, "endSrc", undefined);
	};
	const genAll = (): void => {
		setGenErr(null);
		void (async (): Promise<void> => {
			for (const s of items.filter((i) => !i.img)) await genOne(s);
		})();
	};
	const addScene = (): void => {
		const ns: StudioItem = isVideo
			? {
					id: Date.now(),
					dur: 3,
					name: "New Scene",
					shot: "Medium Shot",
					move: "Static",
					vis: "",
					vo: "",
					castId: refs.speakers[0]?.id,
					img: false,
					refIds: [],
					voiceIds: [],
					noteIds: [],
				}
			: {
					key: mintEntityKey(SLIDE_KEY_PREFIX),
					id: Date.now(),
					name: "New slide",
					cap: "",
					vis: "",
					img: false,
					refIds: [],
					noteIds: [],
				};
		setItems((ss) => [...ss, ns]);
		setActive(ns.id);
	};
	const dup = (s: StudioItem): void => {
		const ns = { ...s, id: Date.now(), img: false };
		setItems((ss) => {
			const i = ss.findIndex((x) => x.id === s.id);
			const a = [...ss];
			a.splice(i + 1, 0, ns);
			return a;
		});
		setActive(ns.id);
	};
	const rm = (id: number): void => setItems((ss) => ss.filter((s) => s.id !== id));
	const move = (id: number, dir: number): void =>
		setItems((ss) => {
			const i = ss.findIndex((s) => s.id === id);
			const j = i + dir;
			if (j < 0 || j >= ss.length) return ss;
			const a = [...ss];
			[a[i], a[j]] = [a[j], a[i]];
			return a;
		});
	const onToggle = (cat: ToggleCat, id: string): void => {
		if (!scene) return;
		const key: ToggleKey = cat === "image" ? "refIds" : cat === "voice" ? "voiceIds" : "noteIds";
		const cur = listOf(scene, key);
		upd(scene.id, key, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
	};

	if (!scene) return null;
	// The open item, narrowed once. Every scene-only field in the panel below reads
	// off this rather than asserting the arm at each use.
	const active_ = isScene(scene) ? scene : null;
	// The storyboard export takes scenes. Filtering through the guard proves the
	// element type instead of asserting the whole list is one arm.
	const scenesOnly = items.filter(isScene);
	const isGen = gen[scene.id];
	const isEndGen = genEnd[scene.id];
	const frameW = Math.max(128, Math.min(300, Math.round(212 * aspect)));
	const effVoices: Speaker[] = active_
		? [
				...refs.speakers.filter((c) => c.default),
				...refs.speakers.filter((c) => (active_.voiceIds || []).includes(c.id) && !c.default),
			]
		: [];
	const castId = active_?.castId;
	const voValue = castId && effVoices.find((c) => c.id === castId) ? castId : effVoices[0]?.id;

	return (
		<div className="cv-studio">
			<aside className="cv-left">
				<ReferenceLibrary
					mode="picker"
					type={type}
					refs={refs}
					setRefs={(fn) => setRefs(fn)}
					pool={pool}
					setPool={(fn) => setPool(fn)}
					products={products}
					projectId={projectId}
					projectSelection={projectSelection}
					onToggleProjectSelection={onToggleProjectSelection}
					sceneRefIds={scene.refIds ?? []}
					onToggleSceneRef={(id) => onToggle("image", id)}
					sceneNoteIds={scene.noteIds ?? []}
					onToggleSceneNote={(id) => onToggle("note", id)}
					sceneCasts={items.map((i) => i.refIds ?? [])}
					primaryEntityId={pool.find((r) => r.primary)?.id ?? null}
					onSetPrimary={onSetPrimary}
					onDeleteRef={onDeleteRef}
					onClose={() => {
						/* the studio rail is always mounted */
					}}
				/>
			</aside>

			<div className="cv-studio-right">
				{genErr && (
					<div
						role="alert"
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "7px 14px",
							background: "var(--err-bg)",
							color: "var(--err)",
							fontSize: 12,
							borderBottom: "1px solid var(--border)",
						}}
					>
						<span style={{ flex: 1 }}>{genErr}</span>
						<IconButton size="xs" onClick={() => setGenErr(null)} title="Dismiss">
							{Ic.x(ICON.sm)}
						</IconButton>
					</div>
				)}
				<StudioStrip
					isVideo={isVideo}
					items={items}
					active={active}
					setActive={setActive}
					view={view}
					setView={setView}
					gen={gen}
					aspect={aspect}
					addScene={addScene}
					genAll={genAll}
				/>

				{view === "studio" && (
					<div className="cv-studio-rcols">
						<SceneCastPicker
							library={pool}
							projectSelection={projectSelection}
							sceneRefIds={scene.refIds ?? []}
							onToggleSceneRef={(id) => onToggle("image", id)}
							onSelectIntoProject={onToggleProjectSelection}
							visualReferenceSettings={projectMaterials?.visual.referenceSettings ?? []}
							sceneText={
								active_
									? isScene(active_)
										? [active_.name, active_.vis, active_.vo].filter(Boolean).join("\n")
										: capOf(active_)
									: ""
							}
							sceneName={active_ ? active_.name : `Slide ${idx + 1}`}
						/>

						<section className="cv-right">
							<div className="cv-panel-h">
								{isVideo ? Ic.film(ICON.sm) : Ic.image(ICON.sm)} {isVideo ? "Scene" : "Slide"}{" "}
								content
								<span className="cv-right-pos">
									{idx + 1}/{items.length}
								</span>
								<div className="cv-right-tools">
									<IconButton
										size="xs"
										onClick={() => move(scene.id, -1)}
										disabled={idx === 0}
										title="Up"
									>
										{Ic.chevD(ICON.sm)}
									</IconButton>
									<IconButton
										size="xs"
										onClick={() => move(scene.id, 1)}
										disabled={idx === items.length - 1}
										style={{ transform: "rotate(180deg)" }}
										title="Down"
									>
										{Ic.chevD(ICON.sm)}
									</IconButton>
									<IconButton size="xs" onClick={() => dup(scene)} title="Duplicate">
										{Ic.layers(ICON.sm)}
									</IconButton>
									{items.length > 1 && (
										<IconButton size="xs" onClick={() => rm(scene.id)} title="Delete">
											{Ic.trash(ICON.sm)}
										</IconButton>
									)}
								</div>
							</div>

							<div className="cv-right-frame">
								<div className="cv-frameslots">
									<div style={{ width: frameW, maxWidth: isVideo ? "100%" : "46%", flexShrink: 0 }}>
										{isVideo && <span className="cv-framecap">Start frame</span>}
										<Frame
											generated={scene.img && !isGen}
											src={scene.src}
											seed={scene.seed || scene.id}
											aspect={aspect}
											icon={isVideo ? Ic.film(ICON.xl) : Ic.image(ICON.xl)}
											label="frame"
											enlargeable
										>
											{isGen && <Shimmer />}
											{/* Image projects are retired: their slides keep their images but generate none. */}
											{isVideo && !scene.img && !isGen && (
												<Button
													variant="primary"
													size="sm"
													className={FRAME_CENTER}
													onClick={() => genFrame(scene.id)}
												>
													{Ic.spark(ICON.sm)} Generate
												</Button>
											)}
											{isVideo && scene.img && !isGen && (
												<FrameActions reveal>
													<FrameAction title="Regenerate" onClick={() => genFrame(scene.id)}>
														{Ic.regen(ICON.xs)}
													</FrameAction>
												</FrameActions>
											)}
											{active_ && <FrameBadge corner="br">{fmtMMSS(active_.dur)}</FrameBadge>}
										</Frame>
									</div>
									{active_ && (
										<div style={{ width: frameW, maxWidth: "100%", flexShrink: 0 }}>
											<span className="cv-framecap">
												End frame <span className="cv-framecap-opt">optional</span>
											</span>
											<Frame
												generated={Boolean(active_.endSrc) && !isEndGen}
												src={active_.endSrc}
												seed={(active_.seed || active_.id) + 1}
												aspect={aspect}
												icon={Ic.film(ICON.xl)}
												label="end frame"
												enlargeable
											>
												{isEndGen && <Shimmer />}
												{!active_.endSrc && !isEndGen && (
													<Button
														variant="primary"
														size="sm"
														className={FRAME_CENTER}
														onClick={() => genFrame(active_.id, "end")}
													>
														{Ic.spark(ICON.sm)} Generate end
													</Button>
												)}
												{active_.endSrc && !isEndGen && (
													<FrameActions>
														<FrameAction
															title="Regenerate end frame"
															onClick={() => genFrame(active_.id, "end")}
														>
															{Ic.regen(ICON.xs)}
														</FrameAction>
														<FrameAction
															danger
															title="Remove end frame"
															onClick={() => clearEndFrame(active_.id)}
														>
															{Ic.x(ICON.xs)}
														</FrameAction>
													</FrameActions>
												)}
											</Frame>
										</div>
									)}
								</div>
								<div className="cv-right-frameside">
									<div className="cv-right-refcount">
										{Ic.layers(ICON.sm)} {refsFor(scene).length} references used
									</div>
									{isVideo && (
										<>
											<div className="cv-right-frametip">
												The clip animates from the start frame to the end frame. Leave the end frame
												empty to animate from a single image.
											</div>
											<Button
												variant="primary"
												size="sm"
												onClick={() => genFrame(scene.id)}
												disabled={isGen}
											>
												{Ic.spark(ICON.sm)}{" "}
												{isGen ? "Generating…" : scene.img ? "Regenerate" : "Generate frame"}
											</Button>
										</>
									)}
								</div>
							</div>

							{isScene(scene) ? (
								<>
									<Field as="div">
										<ML>Scene name</ML>
										<Input
											value={scene.name}
											onChange={(e) => upd(scene.id, "name", e.target.value)}
										/>
									</Field>
									<div className="cv-form-2">
										<Field as="div">
											<ML>Camera / shot</ML>
											<Select
												value={scene.shot}
												onValueChange={(e) => upd(scene.id, "shot", e)}
												phoneBreakpoint={860}
												options={[...(STUDIO_SHOTS.map((x) => ({ value: x, label: x })) ?? [])]}
											/>
										</Field>
										<Field as="div">
											<ML>Movement</ML>
											<Select
												value={scene.move}
												onValueChange={(e) => upd(scene.id, "move", e)}
												phoneBreakpoint={860}
												options={[...(STUDIO_MOVES.map((x) => ({ value: x, label: x })) ?? [])]}
											/>
										</Field>
									</div>
									<div className="cv-form-2">
										<Field as="div">
											<ML>Duration (min:sec)</ML>
											<div className="cv-durrow">
												<button
													className="cv-durstep"
													onClick={() => upd(scene.id, "dur", Math.max(1, scene.dur - 1))}
												>
													–
												</button>
												<DurationField
													value={scene.dur}
													onChange={(v) => upd(scene.id, "dur", v)}
												/>
												<button
													className="cv-durstep"
													onClick={() => upd(scene.id, "dur", Math.min(3600, scene.dur + 1))}
												>
													+
												</button>
											</div>
										</Field>
										<Field as="div">
											<ML>Transition</ML>
											<Select
												value={scene.transition ?? "fade"}
												onValueChange={(e) => upd(scene.id, "transition", e)}
												phoneBreakpoint={860}
												options={[
													...(STUDIO_TRANSITIONS.map((x) => ({ value: x, label: x })) ?? []),
												]}
											/>
										</Field>
									</div>
									<div className="cv-form-2">
										<Field as="div">
											<ML>Story beat</ML>
											<Select
												value={scene.beat ?? ""}
												onValueChange={(e) => upd(scene.id, "beat", e || undefined)}
												phoneBreakpoint={860}
												options={[
													{ value: "", label: "Auto" },
													...(STORY_BEATS.map((x) => ({ value: x, label: x })) ?? []),
												]}
											/>
										</Field>
										<Field as="div">
											<ML>Emotion</ML>
											<Input
												value={scene.emotion ?? ""}
												readOnly
												placeholder="set by style direction"
											/>
										</Field>
									</div>
									<Field as="div">
										<ML>Visual prompt</ML>
										<Textarea
											rows={3}
											value={scene.vis}
											onChange={(e) => upd(scene.id, "vis", e.target.value)}
											placeholder="Describe this shot to generate the frame…"
										/>
									</Field>
									<Field as="div">
										<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
											<ML flush>Voiceover</ML>
											<VoicePicker
												speakers={effVoices}
												value={voValue}
												voiceOptions={ttsVoiceOptions}
												onChange={(v) => upd(scene.id, "castId", v)}
											/>
										</div>
										<Textarea
											rows={2}
											value={scene.vo}
											onChange={(e) => upd(scene.id, "vo", e.target.value)}
											placeholder='"Narration / dialogue for this scene…"'
										/>
										{/* Which speakers this scene can narrate with. A speaker is an audio
										    identity, not a reference entity, so it belongs beside the voiceover
										    rather than in the reference library. Default speakers are always
										    available; these are the extras for this scene. */}
										{refs.speakers.some((c) => !c.default) && (
											<div className="cv-scenespeakers">
												<span className="cv-scenespeakers-h">
													{Ic.mic(ICON.xs)} Also available here
												</span>
												<div className="cv-scenespeakers-list">
													{refs.speakers
														.filter((c) => !c.default)
														.map((c) => {
															const on = (scene.voiceIds ?? []).includes(c.id);
															return (
																<button
																	key={c.id}
																	type="button"
																	className={`cv-chiptoggle ${on ? "on" : ""}`}
																	aria-pressed={on}
																	onClick={() => onToggle("voice", c.id)}
																	title={
																		on
																			? `Remove ${c.name} from this scene`
																			: `Make ${c.name} available for this scene`
																	}
																>
																	{c.name}
																</button>
															);
														})}
												</div>
											</div>
										)}
									</Field>
									<div className="cv-form-2">
										<Field as="div">
											<ML>Action</ML>
											<Input
												value={scene.action || ""}
												onChange={(e) => upd(scene.id, "action", e.target.value)}
												placeholder="What happens…"
											/>
										</Field>
										<Field as="div">
											<ML>SFX / music</ML>
											<Input
												value={scene.sfx || ""}
												onChange={(e) => upd(scene.id, "sfx", e.target.value)}
												placeholder="Sound…"
											/>
										</Field>
									</div>
								</>
							) : (
								<>
									<Field as="div">
										<ML>Visual prompt</ML>
										<Textarea
											rows={3}
											value={scene.vis}
											onChange={(e) => upd(scene.id, "vis", e.target.value)}
											placeholder="Describe the image for this slide…"
										/>
									</Field>
									<Field as="div">
										<ML>Caption</ML>
										<Textarea
											rows={3}
											value={scene.cap}
											onChange={(e) => upd(scene.id, "cap", e.target.value)}
											placeholder="Slide caption…"
										/>
									</Field>
								</>
							)}
						</section>
					</div>
				)}

				{view === "board" && (
					<SceneBoard
						isVideo={isVideo}
						items={items}
						aspect={aspect}
						gen={gen}
						refs={refs}
						pool={pool}
						setActive={setActive}
						setView={setView}
						refCountFor={refCountFor}
					/>
				)}
				{view === "list" && (
					<SceneList
						isVideo={isVideo}
						items={items}
						aspect={aspect}
						gen={gen}
						refs={refs}
						pool={pool}
						setActive={setActive}
						setView={setView}
						refCountFor={refCountFor}
					/>
				)}
				{view === "storyboard" && isVideo && (
					<StoryboardView
						title={config.title?.trim() || scenesOnly[0]?.name || "Storyboard"}
						scenes={scenesOnly}
						config={config}
						refs={refs}
					/>
				)}
			</div>
		</div>
	);
}
