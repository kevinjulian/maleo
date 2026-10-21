import { useSyncExternalStore } from "react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@models/core/theme.ts";

/** The stored theme choice and its setter; every caller sees the same value. */
export function useTheme(): [Theme, (theme: Theme) => void] {
	return [useSyncExternalStore(subscribeTheme, readTheme), setTheme];
}
