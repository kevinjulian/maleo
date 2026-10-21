import { IconButton } from "./icon-button.tsx";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { useTheme } from "@hooks/ui/use-theme.ts";
import { resolveDark } from "@models/core/theme.ts";

/* The quick switch in the top bar. It flips between explicit light and dark;
 * following the system is chosen on the Preferences page. Both read one store. */
export function ThemeToggle({ className }: { className?: string }): JSX.Element {
	const [theme, setTheme] = useTheme();
	const dark = resolveDark(theme);
	return (
		<IconButton
			type="button"
			className={className}
			onClick={() => setTheme(dark ? "light" : "dark")}
			title={dark ? "switch to light theme" : "switch to dark theme"}
			aria-label="toggle theme"
		>
			{dark ? Ic.sun(ICON.md) : Ic.moon(ICON.md)}
		</IconButton>
	);
}
