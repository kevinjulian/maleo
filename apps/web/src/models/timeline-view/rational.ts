/* Exact rational arithmetic, because 30000/1001 is not a float.
 *
 * Everything here is integer arithmetic on a numerator and a denominator. No
 * function in this file produces a float, and none accepts one — a rational
 * built by dividing is already wrong before it is used.
 */

/** An exact ratio of two integers. Always normalised: positive denominator, reduced. */
export interface Rational {
	readonly numerator: number;
	readonly denominator: number;
}

function greatestCommonDivisor(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		const next = x % y;
		x = y;
		y = next;
	}
	return x === 0 ? 1 : x;
}

/**
 * Build a normalised rational.
 *
 * Normalising on construction rather than on comparison is what makes equality
 * a field comparison: 30000/1001 and 60000/2002 are the same rate, and a model
 * that can hold both has two representations of one project timebase.
 */
export function rational(numerator: number, denominator: number): Rational {
	if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
		throw new RangeError(
			`@maleo/vui: a rational needs integers, received ${numerator}/${denominator}`,
		);
	}
	if (denominator === 0)
		throw new RangeError("@maleo/vui: a rational may not have a zero denominator");
	const sign = denominator < 0 ? -1 : 1;
	const divisor = greatestCommonDivisor(numerator, denominator);
	return { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor };
}

/** The product of two rationals, normalised. */
export function rationalMultiply(a: Rational, b: Rational): Rational {
	return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

/** A rational as `n/d`, for diagnostics and for timebase identity in a cache key. */
export function formatRational(value: Rational): string {
	return `${value.numerator}/${value.denominator}`;
}
