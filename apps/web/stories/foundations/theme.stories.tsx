import type { Meta, StoryObj } from "@storybook/react-vite";

/* A render check, not the token reference: it reads live custom properties so
 * a broken stylesheet import, a missing font or a dead theme toggle shows up
 * here first. The token reference lives in docs/design-system/foundations.md. */
const SWATCHES = [
	"--bg",
	"--surface",
	"--fg",
	"--fg-dim",
	"--muted",
	"--border",
	"--dark",
	"--ai",
	"--ok",
	"--warn",
	"--err",
	"--info",
];
const FONTS = ["--font-display", "--font-body"];

function ThemeCheck() {
	return (
		<div className="tw:flex tw:flex-col tw:gap-6">
			<div className="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] tw:gap-3">
				{SWATCHES.map((token) => (
					<div key={token} className="tw:flex tw:flex-col tw:gap-1 tw:text-xs">
						<div
							className="tw:h-12 tw:rounded-md tw:border tw:border-border"
							style={{ background: `var(${token})` }}
						/>
						<code>{token}</code>
					</div>
				))}
			</div>
			{FONTS.map((token) => (
				<div key={token} style={{ fontFamily: `var(${token})` }}>
					<div className="tw:text-xs tw:text-muted-foreground">{token}</div>
					<div style={{ fontSize: 24 }}>Sphinx of black quartz, judge my vow 0123456789</div>
				</div>
			))}
		</div>
	);
}

const meta = { title: "Foundations/Theme Check", component: ThemeCheck } satisfies Meta<
	typeof ThemeCheck
>;

export default meta;
export const Default: StoryObj<typeof meta> = {};
