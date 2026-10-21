/* Set CSS custom properties in a React `style` prop.
 *
 * React's `CSSProperties` is `csstype`'s `Properties`, which lists known CSS
 * properties and nothing else — `{ "--fc-asp": "1.5" }` is a type error, even
 * though it is exactly what the DOM wants. The usual workaround is to assert the
 * key (`{ ["--fc-asp" as string]: value }`), which turns off checking for the
 * whole object literal so that one key can be spelled.
 *
 * This keeps the check where it is worth having. The parameter type accepts ONLY
 * `--`-prefixed keys, so a typo'd or ordinary property name is rejected here —
 * which is more than the per-site assertion was doing, since `as string` on the
 * key made every key legal.
 */
import type { CSSProperties } from "react";

export function cssVars(vars: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
	// SAFETY: custom properties are valid in a `style` object at runtime; only
	// `csstype` does not model them. The template-literal key type above is what
	// keeps this honest — nothing that is not a custom property can get in.
	return vars as CSSProperties;
}
