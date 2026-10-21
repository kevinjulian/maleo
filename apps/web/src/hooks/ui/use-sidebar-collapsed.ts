import { useCallback, useState } from "react";

const KEY = "sidebar-collapsed";

function read(): boolean {
	try {
		return window.localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

/** The desktop sidebar's collapsed state, remembered per browser. */
export function useSidebarCollapsed(): [boolean, () => void] {
	const [collapsed, setCollapsed] = useState(read);
	const toggle = useCallback(() => {
		setCollapsed((was) => {
			const next = !was;
			try {
				window.localStorage.setItem(KEY, next ? "1" : "0");
			} catch {
				/* a private window forgets it on reload; nothing else to do */
			}
			return next;
		});
	}, []);
	return [collapsed, toggle];
}
