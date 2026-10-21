/* Maleo — Content-First Create · Text workspace */
import type { Dispatch, SetStateAction, JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Frame, FrameAction, FrameActions } from "@design-system/components/frame.tsx";
import { mintEntityKey, POST_KEY_PREFIX } from "@maleo/shared";
import type { Config } from "@maleo/shared";
import type { Post } from "@models/content/content-types.ts";
import { Textarea } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

/* ════ Text thread ════
 * Text projects are retired: a thread is edited by hand and generates nothing. An
 * image a post already has stays, and can be removed. */
interface TextWorkspaceProps {
	config: Config;
	posts: Post[];
	setPosts: Dispatch<SetStateAction<Post[]>>;
}
export function TextWorkspace({ config, posts, setPosts }: TextWorkspaceProps): JSX.Element {
	const upd = (id: number, f: string, v: unknown): void =>
		setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, [f]: v } : p)));
	const add = (): void =>
		setPosts((ps) => [
			...ps,
			{
				key: mintEntityKey(POST_KEY_PREFIX, new Set(ps.map((p) => p.key))),
				id: Date.now(),
				body: "",
				img: false,
			},
		]);
	const rm = (id: number): void => setPosts((ps) => ps.filter((p) => p.id !== id));
	const limit = config.platform === "twitter" ? 280 : 500;

	return (
		<div className="cv-vid">
			<div className="cv-timeline">
				<div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
					<span className="cv-mono-pill">
						{config.platform === "twitter"
							? "X / Twitter"
							: config.platform === "threads"
								? "Threads"
								: config.platform || "Thread"}
					</span>
					<span className="cv-mono-pill">
						{posts.length > 1 ? "Thread" : "Single"} · {posts.length}{" "}
						{posts.length > 1 ? "posts" : "post"}
					</span>
				</div>
			</div>

			<div className="cv-thread">
				{posts.map((p, i) => {
					const over = p.body.length > limit;
					return (
						<div key={p.id} className="cv-post" data-entity-key={p.key}>
							<div className="cv-post-rail">
								<span className="cv-post-num">{i + 1}</span>
								{i < posts.length - 1 && <span className="cv-post-line" />}
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<Textarea
									className="cv-post-ta"
									rows={4}
									value={p.body}
									onChange={(e) => upd(p.id, "body", e.target.value)}
									placeholder="Write a post…"
								/>
								{p.img && (
									<div style={{ marginTop: 10, position: "relative", maxWidth: 280 }}>
										<Frame
											generated
											src={p.src}
											seed={p.seed || p.id}
											aspect={4 / 5}
											icon={Ic.image(ICON.lg)}
										>
											<FrameActions>
												<FrameAction
													danger
													title="Remove image"
													onClick={() => upd(p.id, "img", false)}
												>
													{Ic.x(ICON.xs)}
												</FrameAction>
											</FrameActions>
										</Frame>
									</div>
								)}
								<div className="cv-post-foot">
									<span style={{ flex: 1 }} />
									<span
										className="cv-charc"
										style={{ color: over ? "var(--err)" : "var(--muted)" }}
									>
										{p.body.length}/{limit}
									</span>
									{posts.length > 1 && (
										<IconButton size="xs" aria-label="Remove post" onClick={() => rm(p.id)}>
											{Ic.trash(ICON.sm)}
										</IconButton>
									)}
								</div>
							</div>
						</div>
					);
				})}
				<button className="cv-addpost" onClick={add}>
					{Ic.plus(ICON.md)} Add post to thread
				</button>
			</div>
		</div>
	);
}
