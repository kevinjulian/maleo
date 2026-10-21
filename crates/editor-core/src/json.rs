//! JSON output that matches `JSON.stringify` number for number.
//!
//! The persisted document is written by JavaScript, so every number in it is
//! the shortest decimal that round-trips, in ECMAScript's layout (`1e+21`,
//! `1e-7`, `0.000001`, `-0` as `0`). Rust's default float output differs in
//! layout (`1e21`, `1e-7`, `0.0`), so a value the engine never touched would
//! change its bytes on save. This formatter writes ECMAScript's layout from
//! Rust's own shortest round-trip digits, so an untouched number serializes
//! exactly as it was read and a computed one exactly as the TS executor writes
//! it.

use serde::Serialize;
use serde_json::ser::{Formatter, Serializer};
use std::io;

/// ECMAScript `Number::toString(x)` for a finite `x` (ECMA-262, radix 10).
///
/// Returns `None` for NaN and infinities, which JSON cannot carry; the TS
/// executor would write them as `null`, and the engine refuses them instead.
pub fn js_number_string(x: f64) -> Option<String> {
    if !x.is_finite() {
        return None;
    }
    if x == 0.0 {
        return Some("0".to_owned());
    }
    if x < 0.0 {
        return js_number_string(-x).map(|s| format!("-{s}"));
    }
    // Rust's `{:e}` is the shortest round-trip digit string, as `d.ddd e N`.
    let sci = format!("{x:e}");
    let (mantissa, exponent) = sci.split_once('e')?;
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().ok()? + 1;
    let out = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (int, frac) = digits.split_at(n as usize);
        format!("{int}.{frac}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let (head, tail) = digits.split_at(1);
        let tail = if tail.is_empty() { String::new() } else { format!(".{tail}") };
        format!("{head}{tail}e{sign}{}", (n - 1).abs())
    };
    Some(out)
}

/// The default (compact) formatter, with floats written by [`js_number_string`].
struct JsFormatter;

impl Formatter for JsFormatter {
    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        let text = js_number_string(value).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "non-finite number cannot be written as JSON"))?;
        writer.write_all(text.as_bytes())
    }

    fn write_f32<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }
}

/// Serialize as `JSON.stringify(value)` would: compact, ECMAScript numbers.
pub fn to_js_string<T: Serialize>(value: &T) -> Result<String, String> {
    let mut out = Vec::new();
    let mut serializer = Serializer::with_formatter(&mut out, JsFormatter);
    value.serialize(&mut serializer).map_err(|error| error.to_string())?;
    String::from_utf8(out).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::js_number_string;

    #[test]
    fn matches_ecmascript_layout() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (2.0, "2"),
            (-2.5, "-2.5"),
            (0.1, "0.1"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1.0 / 3.0, "0.3333333333333333"),
            (123456789012.5, "123456789012.5"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (1e20, "100000000000000000000"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (4096.0, "4096"),
            (12.5, "12.5"),
            (9007199254740991.0, "9007199254740991"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
        ];
        for (value, expected) in cases {
            assert_eq!(js_number_string(*value).as_deref(), Some(*expected), "{value:e}");
        }
    }

    #[test]
    fn refuses_non_finite() {
        assert_eq!(js_number_string(f64::NAN), None);
        assert_eq!(js_number_string(f64::INFINITY), None);
    }
}
