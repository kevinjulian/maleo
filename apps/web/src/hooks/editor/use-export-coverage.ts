/* The export menu's Rust coverage check (OpenSpec p2-export E1).
 *
 * Each time the menu opens, the storyboard export would render is checked for
 * whole-project coverage. The renderer module loads on the first check, never
 * on a normal editor load. A result for an older opening never replaces a
 * newer one. */
import { useEffect, useRef, useState } from "react";
import {
	loadExportCoverage,
	type ExportCoverage,
	type ExportSource,
} from "@models/render/export-coverage.ts";

export type CoverageCheck = (source: ExportSource) => Promise<ExportCoverage>;

export function useExportCoverage(
	open: boolean,
	read: () => ExportSource | null,
	check: CoverageCheck = loadExportCoverage,
): ExportCoverage | null {
	const [coverage, setCoverage] = useState<ExportCoverage | null>(null);
	const generation = useRef(0);
	const readRef = useRef(read);
	readRef.current = read;
	useEffect(() => {
		if (!open) return;
		const source = readRef.current();
		if (!source) {
			setCoverage({ state: "error", message: "The preview is not ready yet." });
			return;
		}
		const mine = ++generation.current;
		setCoverage({ state: "checking" });
		void check(source).then((result) => {
			if (mine === generation.current) setCoverage(result);
		});
		return () => {
			generation.current++;
		};
	}, [open, check]);
	return coverage;
}
