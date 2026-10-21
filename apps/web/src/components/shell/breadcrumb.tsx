import { Fragment, type JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";

export type CrumbSeg = { label: string; go?: () => void };

export function Breadcrumb({ segs }: { segs: CrumbSeg[] }): JSX.Element {
	return (
		<>
			{segs.map((s, i) => {
				const last = i === segs.length - 1;
				return (
					<Fragment key={i}>
						{i > 0 && <span className="crumb-sep">{Ic.chevronRight(ICON.sm)}</span>}
						{last ? (
							<span className="crumb-cur">{s.label}</span>
						) : s.go ? (
							<button className="crumb-link" onClick={s.go}>
								{s.label}
							</button>
						) : (
							<span className="crumb-static">{s.label}</span>
						)}
					</Fragment>
				);
			})}
		</>
	);
}
