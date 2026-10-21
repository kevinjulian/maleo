import { useState } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Popover, PopoverTrigger, PopoverContent } from "@design-system/components/popover.tsx";
import { PresetUsageLine } from "@components/catalog/preset-usage-line.tsx";
import { actionLabel } from "./panel-rows.ts";
import type { ProvenanceActions } from "./panel-shell.tsx";

/** Existing provenance commands next to an inline project value. */
export function ProjectPropertyActions({
	label,
	path,
	changed,
	actions,
}: {
	label: string;
	path: string;
	changed: boolean;
	actions: ProvenanceActions;
}) {
	const [open, setOpen] = useState(false);
	const commands = actions.actionsFor(changed, path).filter((action) => action !== "change");
	if (!commands.length) return null;
	const handBack = actions.handBackTargetFor(path);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<IconButton size="xs" aria-label={`${label} default actions`}>
					{Ic.more(ICON.xs)}
				</IconButton>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-label={`${label} default actions`}
				className="tw:max-w-72 tw:flex tw:flex-col tw:gap-3"
			>
				{commands.map((command) => (
					<div key={command}>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								actions.runAction([path])(command);
								setOpen(false);
							}}
						>
							{actionLabel(command)}
						</Button>
						<p className="fc-cap-desc">
							{command === "use-default" || command === "reset-to-shipped"
								? handBack
									? `Returns to the value ${handBack} supplies.`
									: "Returns to the value that ships in code."
								: command === "save-as-custom-default"
									? `Creates a custom default${actions.writeBackTargetName ? ` from ${actions.writeBackTargetName}` : ""}. The built-in default stays unchanged.`
									: `Writes this value into ${actions.writeBackTargetName}.`}
						</p>
						{command === "update-default" && actions.usagePresetId && (
							<PresetUsageLine presetId={actions.usagePresetId} />
						)}
					</div>
				))}
			</PopoverContent>
		</Popover>
	);
}
