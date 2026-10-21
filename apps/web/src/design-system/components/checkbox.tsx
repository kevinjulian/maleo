import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";

export type CheckboxProps = Omit<BaseCheckbox.Root.Props, "className"> & { className?: string };

export function Checkbox({ className, ...props }: CheckboxProps): React.JSX.Element {
	return (
		<BaseCheckbox.Root
			render={<button type="button" />}
			nativeButton
			data-slot="checkbox"
			className={cn(
				"tw:relative tw:inline-flex tw:size-4 tw:pointer-coarse:min-h-[var(--control-h-touch)] " +
					"tw:pointer-coarse:min-w-[var(--control-h-touch)] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md " +
					"tw:border tw:border-input tw:hover:border-[var(--border-strong)] tw:active:bg-pressed tw:bg-background " +
					"tw:text-ai-foreground tw:cursor-pointer tw:data-checked:border-ai-border tw:data-checked:bg-ai " +
					"tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring " +
					"tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:aria-invalid:border-destructive",
				className,
			)}
			{...props}
		>
			<BaseCheckbox.Indicator
				data-slot="checkbox-indicator"
				className="tw:grid tw:place-content-center"
			>
				{Ic.check(ICON.xs)}
			</BaseCheckbox.Indicator>
		</BaseCheckbox.Root>
	);
}
