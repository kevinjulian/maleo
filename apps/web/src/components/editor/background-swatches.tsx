/* The Style panel's background presets: solid fills and gradients, each a pickable swatch. */
import type { JSX } from "react";

export const SOLID_BACKGROUNDS = [
	"#000000",
	"#111827",
	"#242225",
	"#665f59",
	"#EF2E37",
	"#F45B12",
	"#F79009",
	"#EAB308",
	"#5AC70B",
	"#3DBB4B",
	"#3AAE77",
	"#3FB09C",
	"#3BA7C4",
	"#348FDB",
	"#3263E8",
	"#4C46E5",
	"#7438E8",
	"#9333EA",
	"#C91BDE",
	"#DB2777",
	"#E11D48",
	"#F4E8A7",
	"#D7B7F6",
	"#FFFFFF",
] as const;
export const GRADIENT_BACKGROUNDS = [
	"linear-gradient(135deg, #F97316 0%, #E11D48 100%)",
	"linear-gradient(135deg, #2EA8D8 0%, #3263E8 100%)",
	"linear-gradient(135deg, #40B855 0%, #36B37E 100%)",
	"linear-gradient(135deg, #7C3AED 0%, #DB2777 100%)",
	"linear-gradient(135deg, #F97316 0%, #F43F5E 100%)",
	"linear-gradient(135deg, #1E1B4B 0%, #4338CA 100%)",
	"linear-gradient(135deg, #FDE68A 0%, #F9A8D4 100%)",
	"linear-gradient(135deg, #991B1B 0%, #F97316 100%)",
	"linear-gradient(135deg, #8B5CF6 0%, #0EA5E9 100%)",
	"linear-gradient(135deg, #082F49 0%, #2563EB 100%)",
	"linear-gradient(135deg, #FDE68A 0%, #F59E0B 100%)",
	"linear-gradient(135deg, #3B0764 0%, #A21CAF 100%)",
	"linear-gradient(135deg, #115E59 0%, #E11D48 100%)",
	"linear-gradient(135deg, #BFDBFE 0%, #C4B5FD 100%)",
	"linear-gradient(135deg, #111827 0%, #4B5563 100%)",
	"linear-gradient(135deg, #E0E7FF 0%, #F8FAFC 100%)",
	"linear-gradient(135deg, #3B0764 0%, #A21CAF 45%, #7C3AED 100%)",
	"linear-gradient(135deg, #86EFAC 0%, #60A5FA 100%)",
	"linear-gradient(135deg, #38BDF8 0%, #7C3AED 100%)",
	"linear-gradient(135deg, #A855F7 0%, #7C3AED 100%)",
] as const;

export function SwatchGroup({
	title,
	values,
	active,
	onPick,
}: {
	title: string;
	values: readonly string[];
	active: string;
	onPick: (fill: string) => void;
}): JSX.Element {
	return (
		<section className="fc-bg-group">
			<div className="fc-bg-group-h">
				<span>{title}</span>
				<b>{values.length}</b>
			</div>
			<div className="fc-bg-grid">
				{values.map((v) => (
					<button
						key={v}
						type="button"
						className={`fc-bg-swatch${active === v ? " on" : ""}`}
						style={{ background: v }}
						title={v}
						aria-label={`Use ${title.toLowerCase()} background ${v}`}
						onClick={() => onPick(v)}
					/>
				))}
			</div>
		</section>
	);
}
