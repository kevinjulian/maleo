/* A column's name.
 *
 * One component so the three columns cannot drift into three different heading
 * treatments — the failure `page-chrome` describes at page scale, at column
 * scale. Mono uppercase micro-type: it labels a region, and anything larger
 * would compete with the provider title that is the actual subject.
 */
import type { JSX } from "react";

export function ColumnHead({ children }: { children: string }): JSX.Element {
	return <h2 className="settings-col-title">{children}</h2>;
}
