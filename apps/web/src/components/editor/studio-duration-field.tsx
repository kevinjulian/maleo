import { useEffect, useState } from "react";
import type { JSX } from "react";
import { fmtMMSS, parseMMSS } from "@models/core/measures.ts";
import { Input } from "@design-system/components/input.tsx";

interface DurationFieldProps {
	value: number;
	onChange: (s: number) => void;
}
export function DurationField({ value, onChange }: DurationFieldProps): JSX.Element {
	const [txt, setTxt] = useState(fmtMMSS(value));
	useEffect(() => {
		setTxt(fmtMMSS(value));
	}, [value]);
	const commit = (): void => {
		const s = Math.max(1, Math.min(3600, parseMMSS(txt)));
		onChange(s);
		setTxt(fmtMMSS(s));
	};
	return (
		<Input
			className="cv-durinput"
			value={txt}
			onChange={(e) => setTxt(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
			}}
			placeholder="0:03"
			inputMode="numeric"
		/>
	);
}
