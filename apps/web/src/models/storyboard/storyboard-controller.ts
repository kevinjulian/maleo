import {
	applyStoryboardCommand,
	STORYBOARD_MISSING_REVISION_ID,
	storyboardGenerationStateSchema,
	type StoryboardCommand,
	type StoryboardGenerationState,
	type StoryExtensionPolicy,
} from "@maleo/shared";

export interface StoryboardControllerFailure {
	ok: false;
	reason: "conflict" | "invalid" | "locked" | "not_found";
	message: string;
	state: StoryboardGenerationState | null;
	legacy: boolean;
	generatedByBeatId: GeneratedByBeatId;
	references?: StoryboardReferenceDisplays;
}

export type StoryboardControllerMutation =
	| {
			ok: true;
			state: StoryboardGenerationState;
			legacy: false;
			generatedByBeatId: GeneratedByBeatId;
			references?: StoryboardReferenceDisplays;
	  }
	| StoryboardControllerFailure;

export type GeneratedByBeatId = Readonly<
	Record<string, readonly Readonly<Record<string, unknown>>[]>
>;
export type StoryboardReferenceDisplays = Readonly<
	Record<string, { label: string; role: string; source: "existing" | "planned" }>
>;

export interface StoryboardControllerTransport {
	load: () => Promise<{
		state: StoryboardGenerationState | null;
		legacy: boolean;
		generatedByBeatId: GeneratedByBeatId;
		references?: StoryboardReferenceDisplays;
	}>;
	command: (
		revisionId: string,
		command: StoryboardCommand,
	) => Promise<StoryboardControllerMutation>;
	approve: (
		revisionId: string,
		policy: StoryExtensionPolicy,
	) => Promise<StoryboardControllerMutation>;
}

export interface StoryboardControllerView {
	confirmed: StoryboardGenerationState | null;
	storyboard: StoryboardGenerationState | null;
	legacy: boolean;
	generatedByBeatId: GeneratedByBeatId;
	references: StoryboardReferenceDisplays;
	selectedBeatId: string | null;
	pending: boolean;
	loading: boolean;
	error: string | null;
	conflict: StoryboardControllerFailure | null;
	textDrafts: Readonly<Record<string, { narration?: string; visualPrompt?: string }>>;
}

interface QueuedCommand {
	command: StoryboardCommand;
	resolve: (result: StoryboardControllerMutation) => void;
	reject: (error: unknown) => void;
}

function optimisticState(
	state: StoryboardGenerationState | null,
	command: StoryboardCommand,
): StoryboardGenerationState | null {
	if (!state) {
		if (command.type !== "add_section") return null;
		return storyboardGenerationStateSchema.parse({
			planId: "optimistic-plan",
			draft: { revisionId: "optimistic-revision", sections: [command.section] },
		});
	}
	const result = applyStoryboardCommand(
		state,
		state.draft.revisionId,
		command,
		"optimistic-revision",
	);
	return result.ok ? result.state : state;
}

export class StoryboardController {
	private view: StoryboardControllerView = {
		confirmed: null,
		storyboard: null,
		legacy: false,
		generatedByBeatId: {},
		references: {},
		selectedBeatId: null,
		pending: false,
		loading: false,
		error: null,
		conflict: null,
		textDrafts: {},
	};
	private readonly listeners = new Set<() => void>();
	private readonly queue: QueuedCommand[] = [];
	private running = false;

	constructor(private readonly transport: StoryboardControllerTransport) {}

	getSnapshot = (): StoryboardControllerView => this.view;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	private update(patch: Partial<StoryboardControllerView>): void {
		this.view = { ...this.view, ...patch };
		for (const listener of this.listeners) listener();
	}

	refresh = async (): Promise<void> => {
		this.update({ loading: true, error: null });
		try {
			const value = await this.transport.load();
			this.update({
				confirmed: value.state,
				storyboard: value.state,
				legacy: value.legacy,
				generatedByBeatId: value.generatedByBeatId,
				references: value.references ?? {},
				loading: false,
				conflict: null,
			});
		} catch (error) {
			this.update({
				loading: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	selectBeat = (beatId: string | null): void => {
		this.update({ selectedBeatId: beatId });
	};

	setTextDraft = (beatId: string, fields: { narration?: string; visualPrompt?: string }): void => {
		this.update({
			textDrafts: {
				...this.view.textDrafts,
				[beatId]: { ...this.view.textDrafts[beatId], ...fields },
			},
		});
	};

	submit = (command: StoryboardCommand): Promise<StoryboardControllerMutation> => {
		if (this.view.conflict) return Promise.resolve(this.view.conflict);
		return new Promise((resolve, reject) => {
			this.queue.push({ command, resolve, reject });
			void this.drain();
		});
	};

	private async drain(): Promise<void> {
		if (this.running || this.view.conflict) return;
		const next = this.queue.shift();
		if (!next) return;
		this.running = true;
		const confirmed = this.view.confirmed;
		const expected = confirmed?.draft.revisionId ?? STORYBOARD_MISSING_REVISION_ID;
		this.update({
			storyboard: optimisticState(confirmed, next.command),
			pending: true,
			error: null,
		});
		try {
			const result = await this.transport.command(expected, next.command);
			if (result.ok) {
				const beatId = "beatId" in next.command ? next.command.beatId : null;
				const textDrafts = { ...this.view.textDrafts };
				if (beatId && next.command.type === "update_beat") delete textDrafts[beatId];
				this.update({
					confirmed: result.state,
					storyboard: result.state,
					legacy: false,
					generatedByBeatId: result.generatedByBeatId,
					references: result.references ?? this.view.references,
					pending: false,
					textDrafts,
				});
			} else if (result.reason === "conflict") {
				this.update({
					confirmed: result.state,
					storyboard: result.state,
					legacy: result.legacy,
					generatedByBeatId: result.generatedByBeatId,
					references: result.references ?? this.view.references,
					pending: false,
					conflict: result,
				});
				for (const queued of this.queue.splice(0)) queued.resolve(result);
			} else {
				this.update({
					confirmed: result.state,
					storyboard: result.state,
					generatedByBeatId: result.generatedByBeatId,
					references: result.references ?? this.view.references,
					pending: false,
					error: result.message,
				});
			}
			next.resolve(result);
		} catch (error) {
			this.update({
				storyboard: confirmed,
				pending: false,
				error: error instanceof Error ? error.message : String(error),
			});
			next.reject(error);
		} finally {
			this.running = false;
			if (!this.view.conflict) void this.drain();
		}
	}

	approve = async (policy: StoryExtensionPolicy): Promise<StoryboardControllerMutation | null> => {
		if (this.view.conflict) return this.view.conflict;
		if (this.running || this.queue.length || !this.view.confirmed) return null;
		this.update({ pending: true, error: null });
		try {
			const result = await this.transport.approve(this.view.confirmed.draft.revisionId, policy);
			if (result.ok)
				this.update({
					confirmed: result.state,
					storyboard: result.state,
					legacy: false,
					generatedByBeatId: result.generatedByBeatId,
					references: result.references ?? this.view.references,
					pending: false,
				});
			else if (result.reason === "conflict")
				this.update({
					confirmed: result.state,
					storyboard: result.state,
					legacy: result.legacy,
					generatedByBeatId: result.generatedByBeatId,
					references: result.references ?? this.view.references,
					pending: false,
					conflict: result,
				});
			else this.update({ pending: false, error: result.message });
			return result;
		} catch (error) {
			this.update({
				pending: false,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};
}
