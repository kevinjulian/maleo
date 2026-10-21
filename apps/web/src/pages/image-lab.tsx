/* The image lab route: a prompt feed over one workspace.
 *
 * The gallery it used to hold in a drawer is now its own route (/images). The lab
 * keeps the generation session; browsing every project's output is a separate
 * destination, reachable from the header rather than from a slide-over. */
import { useCallback, useRef } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useImageServiceHealth } from "@hooks/image-lab/use-image-service-health.ts";
import { useImageSession } from "@hooks/image-lab/use-image-session.ts";
import { useReferencePicker } from "@hooks/image-lab/use-reference-picker.ts";
import { useImageProviderStatus } from "@hooks/settings/use-image-provider-status.ts";
import { ChatBubble } from "@components/image-lab/chat-bubble.tsx";
import { ImagePromptComposer } from "@components/image-lab/prompt-composer.tsx";

export function ImageLabPage(): JSX.Element {
	const feedRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	/* The feed is scrolled by whoever appends to it — on history load, on
	 * submit, and when a generation lands — rather than by an effect on
	 * `messages`, which would also fire on each elapsed-seconds patch. */
	const scrollToBottom = useCallback(() => {
		requestAnimationFrame(() => {
			if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
		});
	}, []);

	const health = useImageServiceHealth();
	const imageProvider = useImageProviderStatus();
	const refs = useReferencePicker();
	const session = useImageSession({ onFeedGrew: scrollToBottom });

	const reusePrompt = (p: string): void => {
		session.setPrompt(p);
		inputRef.current?.focus();
	};

	return (
		<div className="imagelab-chat">
			<div ref={feedRef} className="imagelab-feed">
				{session.messages.length === 0 && (
					<div className="imagelab-empty">
						{Ic.image(ICON.display)}
						{/* Names the workspace it is empty FOR. There is always an active
						    workspace now, so "select a workspace" is no longer a state
						    the lab can be in — but an empty lab in a workspace that has
						    never generated is the ordinary case, and it has to read as
						    empty rather than as broken. */}
						<span>
							No generations in <strong>{session.workspace}</strong> yet. Type a prompt below.
						</span>
					</div>
				)}
				{session.messages.map((msg) => (
					<ChatBubble key={msg.id} msg={msg} onReuse={reusePrompt} />
				))}
			</div>

			<ImagePromptComposer
				refs={refs}
				prompt={session.prompt}
				onPrompt={session.setPrompt}
				aspect={session.aspect}
				onAspect={session.setAspect}
				imageProvider={imageProvider}
				busy={session.busy}
				health={health}
				workspace={session.workspace}
				inputRef={inputRef}
				onSubmit={() => void session.submit(refs.referenceUrls)}
			/>

			<style>{`
				@keyframes slideInRight {
					from { transform: translateX(100%); }
					to { transform: translateX(0); }
				}
			`}</style>
		</div>
	);
}
