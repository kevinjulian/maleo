import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Progress } from "@design-system/components/progress.tsx";
import { Separator } from "@design-system/components/separator.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";

/* Canonical feedback and structure primitives. */
function Feedback() {
	return null;
}
const meta = { title: "Components/Feedback", component: Feedback } satisfies Meta<typeof Feedback>;
export default meta;
type Story = StoryObj<typeof meta>;

/* Decorative beside text; labelled when it stands alone. Icon-scale sizes. */
export const SpinnerSizes: Story = {
	name: "Spinner",
	render: () => (
		<div className="tw:flex tw:items-center tw:gap-4">
			<Spinner size="xs" />
			<Spinner size="sm" />
			<Spinner size="md" />
			<Spinner size="lg" label="Loading media" />
			<Button variant="secondary" size="sm" loading>
				Rendering
			</Button>
		</div>
	),
};

export const ProgressStates: Story = {
	name: "Progress",
	render: () => (
		<div className="tw:flex tw:max-w-sm tw:flex-col tw:gap-4">
			<Progress label="Render" value={0} />
			<Progress label="Render" value={42} />
			<Progress label="Render" value={100} />
			<Progress label="Preparing export" value={null} />
			<Progress label="Upload" value={68} hideLabel />
		</div>
	),
};

export const SeparatorOrientations: Story = {
	name: "Separator",
	render: () => (
		<div className="tw:flex tw:max-w-sm tw:flex-col tw:gap-3 tw:text-sm">
			<span>Workspace</span>
			<Separator />
			<span>Danger zone</span>
			<div className="tw:flex tw:h-8 tw:items-center tw:gap-2">
				<Button variant="ghost" size="sm">
					Undo
				</Button>
				<Button variant="ghost" size="sm">
					Redo
				</Button>
				<Separator orientation="vertical" />
				<Button variant="ghost" size="sm">
					Split
				</Button>
			</div>
		</div>
	),
};
