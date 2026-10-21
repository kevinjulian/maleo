import type { JSX } from "react";
import { useTheme } from "@hooks/ui/use-theme.ts";
import { THEMES, type Theme } from "@models/core/theme.ts";
import { AccountGroup } from "./account-group.tsx";

const LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "Match system" };

export function PreferencesPanel(): JSX.Element {
	const [theme, setTheme] = useTheme();
	return (
		<AccountGroup title="Theme" description="Applies to this browser.">
			<fieldset className="tw:m-0 tw:flex tw:flex-col tw:gap-2 tw:border-0 tw:p-0">
				<legend className="tw:sr-only">Theme</legend>
				{THEMES.map((value) => (
					<label
						key={value}
						className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-sm"
					>
						<input
							type="radio"
							name="theme"
							value={value}
							checked={theme === value}
							onChange={() => setTheme(value)}
						/>
						{LABEL[value]}
					</label>
				))}
			</fieldset>
		</AccountGroup>
	);
}
