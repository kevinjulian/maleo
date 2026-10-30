import type { ChatModelSelection } from "@hooks/editor/use-chat-model-selection.ts";
import { Select } from "@design-system/components/select.tsx";
import { ErrorState } from "@design-system/patterns/collection.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";

export function ChatModelPicker({ model }: { model: ChatModelSelection }) {
	const key = (choice: { providerId: string; model: string }) =>
		`${choice.providerId}:${choice.model}`;
	return (
		<div className="tw:flex tw:min-w-0 tw:w-full tw:flex-wrap tw:items-center tw:gap-2">
			<Select
				aria-label="Chat model"
				width="auto"
				value={model.choice ? key(model.choice) : ""}
				placeholder="Choose a model"
				disabled={model.saving}
				options={model.choices.map(({ selection, source }) => ({
					value: key(selection),
					label: selection.model,
					description: source === "declared" ? "Declared by instance owner" : undefined,
				}))}
				onValueChange={(value) => {
					const next = model.choices.find((item) => key(item.selection) === value);
					if (next) void model.select(next.selection);
				}}
			/>
			{model.loading && (
				<span role="status">
					<Spinner /> Loading models
				</span>
			)}
			{model.saving && (
				<span role="status">
					<Spinner /> Saving model choice
				</span>
			)}
			{model.saveError && (
				<ErrorState
					inline
					title="Model choice not saved"
					message={model.saveError}
					onRetry={model.retrySave}
					retrying={model.saving}
				/>
			)}
			{model.error && (
				<ErrorState
					inline
					title="Model discovery failed"
					message={model.error}
					onRetry={model.retry}
					retrying={model.loading}
				/>
			)}
			{!model.loading && !model.valid && !model.error && (
				<span role="status">Choose an available model before sending.</span>
			)}
		</div>
	);
}
