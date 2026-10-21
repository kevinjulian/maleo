import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@models/core/cn.ts";

/* `sm` is the editor step: a 16px track beside 24px editor fields, where the
 * default 24x42 switch is the largest thing in the row. */
const SWITCH_SIZE = {
	default: { root: "tw:h-6 tw:w-10", thumb: "tw:size-5 tw:data-checked:translate-x-4" },
	sm: { root: "tw:h-4 tw:w-7", thumb: "tw:size-3 tw:data-checked:translate-x-3" },
} as const;

export type SwitchProps = Omit<BaseSwitch.Root.Props, "className"> & {
	className?: string;
	size?: keyof typeof SWITCH_SIZE;
};

export function Switch({ className, size = "default", ...props }: SwitchProps): React.JSX.Element {
	return (
		<BaseSwitch.Root
			data-slot="switch"
			className={cn(
				"tw:group/switch tw:relative tw:inline-flex",
				SWITCH_SIZE[size].root,
				"tw:shrink-0 tw:items-center tw:rounded-full tw:border-0 tw:bg-muted-foreground tw:p-0.5 tw:cursor-pointer tw:transition-colors tw:hover:opacity-90 tw:data-checked:bg-ai tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:data-disabled:cursor-not-allowed tw:data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<BaseSwitch.Thumb
				data-slot="switch-thumb"
				className={cn(
					"tw:block tw:rounded-full tw:bg-background tw:shadow-sm tw:transition-transform",
					SWITCH_SIZE[size].thumb,
				)}
			/>
		</BaseSwitch.Root>
	);
}
