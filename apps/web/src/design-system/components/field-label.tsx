/* Field label — the Label role for a label stacked above its control.
 *
 * Its appearance lives in field-label.css. `ML` is the historical name the
 * call sites use; the mono, uppercase micro label it once drew is retired. */
import type { LabelHTMLAttributes, JSX } from "react";
import { cn } from "@models/core/cn.ts";
import "./field-label.css";

export type MLProps = LabelHTMLAttributes<HTMLLabelElement> & {
	/** Drop the bottom margin. Every caller that passed a style prop passed this. */
	flush?: boolean;
};

export function ML({ flush, className, ...rest }: MLProps): JSX.Element {
	return <label className={cn("ui-ml", flush ? "ui-ml-flush" : "", className)} {...rest} />;
}
