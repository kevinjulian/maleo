/* Existing timeline import path; shared workspace owns accordion appearance. */
import type { ComponentProps, JSX } from "react";
import { AccordionSection as VuiAccordionSection } from "@components/editor-workspace/primitives.tsx";

export type InspectorSectionProps = Omit<ComponentProps<typeof VuiAccordionSection>, "className">;

export function AccordionSection(props: InspectorSectionProps): JSX.Element {
	return <VuiAccordionSection {...props} className="tl2-acc" />;
}
