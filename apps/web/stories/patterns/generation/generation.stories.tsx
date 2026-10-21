import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { ChatMessage, ToolCall } from "@design-system/patterns/chat.tsx";
import {
	GenerationCard,
	GenerationError,
	GenerationProgress,
} from "@design-system/patterns/generation.tsx";

/* One run of generation work. Colour is the state, and only the newest run
 * (the frontier) carries an action. */
const meta = {
	title: "Patterns/Generation",
	component: GenerationProgress,
	args: { label: "Rewrite narration" },
	decorators: [
		(Story) => (
			<div className="tw:flex tw:w-96 tw:flex-col tw:gap-2 tw:bg-background tw:p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof GenerationProgress>;

export default meta;
type Story = StoryObj<typeof meta>;
const stop = (
	<Button variant="secondary" size="sm">
		Stop
	</Button>
);

export const Running: Story = {
	args: {
		running: true,
		tone: "active",
		count: { done: 1, total: 3, unit: "steps" },
		action: stop,
	},
};
export const RunningUnmeasured: Story = {
	args: { running: true, tone: "active", label: "Working" },
};
export const Done: Story = {
	args: { label: "Done", count: { done: 3, total: 3, unit: "sections" } },
};
export const PartlyDone: Story = {
	args: {
		label: "Partly done",
		tone: "warn",
		action: (
			<Button variant="secondary" size="sm">
				Retry failed sections
			</Button>
		),
	},
};
export const Failed: Story = {
	args: {
		label: "Planning timed out",
		tone: "error",
		action: (
			<Button variant="secondary" size="sm">
				Retry
			</Button>
		),
	},
};
export const History: Story = { args: { label: "Failed" } };

export const Error: StoryObj<typeof GenerationError> = {
	render: () => (
		<GenerationError
			title="Image provider rejected the request"
			code="provider_400"
			message="The prompt was refused. Rephrase it and try again."
			detail="status 400 · moderation · request 7f3a"
		/>
	),
};

export const Card: StoryObj<typeof GenerationCard> = {
	render: () => (
		<GenerationCard
			phase="partial"
			frontier
			status={
				<GenerationProgress
					label="Partly done"
					tone="warn"
					count={{ done: 2, total: 3, unit: "sections" }}
					action={
						<Button variant="secondary" size="sm">
							Retry failed sections
						</Button>
					}
				/>
			}
		>
			<ToolCall name="generate section" status="done" note="2 sections completed and kept" />
			<GenerationError
				title="Section 3 failed"
				code="timeout"
				message="The provider did not answer in time."
				detail="request 91c2 · 60s"
			/>
			<ChatMessage speaker="assistant">
				Two sections are ready. The third can be retried on its own.
			</ChatMessage>
		</GenerationCard>
	),
};
