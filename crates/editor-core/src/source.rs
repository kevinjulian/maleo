//! Source timing: where in the original media a clip's window reads from.
//!
//! A line-for-line port of `packages/shared/src/source-interval.ts`. The
//! arithmetic is f64 in the same order as the TS, so results are bit-identical
//! (design decision 4): reorder nothing here without changing both.

use serde_json::Value;

use crate::error::{EngineError, EngineResult};

pub use maleo_media::timing::SourceInterval;

pub fn source_interval(start: f64, duration: f64, rate: f64) -> EngineResult<SourceInterval> {
    maleo_media::timing::source_interval(start, duration, rate).map_err(EngineError::InvalidSourceInterval)
}
pub fn slice_source_interval(start: f64, duration: f64, rate: f64, reverse: bool, from: f64, to: f64) -> EngineResult<SourceInterval> {
    maleo_media::timing::slice_source_interval(start, duration, rate, reverse, from, to).map_err(EngineError::InvalidSourceInterval)
}
pub fn assert_source_interval(start: f64, duration: f64, rate: f64, source_duration: f64) -> EngineResult<()> {
    maleo_media::timing::assert_source_interval(start, duration, rate, source_duration).map_err(EngineError::InvalidSourceInterval)
}
pub fn source_time(start: f64, duration: f64, rate: f64, reverse: bool, elapsed: f64) -> EngineResult<f64> {
    maleo_media::timing::source_time(start, duration, rate, reverse, elapsed).map_err(EngineError::InvalidSourceInterval)
}
pub fn retime_source_duration(start: f64, duration: f64, previous_rate: f64, next_rate: f64) -> EngineResult<f64> {
    maleo_media::timing::retime_source_duration(start, duration, previous_rate, next_rate).map_err(EngineError::InvalidSourceInterval)
}

/// `editableRate(rate)`: stored rates outside the editable range read as the
/// editor shows them. A missing or non-numeric rate is 1, as `Number.isFinite`
/// is false for anything that is not a finite number.
pub fn editable_rate(rate: Option<&Value>) -> f64 {
    match rate.and_then(Value::as_f64) {
        Some(value) if value.is_finite() => value.clamp(0.25, 4.0),
        _ => 1.0,
    }
}

/// JavaScript truthiness of a JSON value, for `x ? …` and `x ?? false` reads.
pub fn js_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn slices_forward_and_reversed_windows() {
        // Forward 2x: the window 1..2 of a clip starting at source 10 reads 12..14.
        assert_eq!(slice_source_interval(10.0, 3.0, 2.0, false, 1.0, 2.0), Ok(SourceInterval { start: 12.0, end: 14.0 }));
        // Reversed 2x: the window 0.5..2.5 reads from the far end, source 11..15.
        assert_eq!(slice_source_interval(10.0, 3.0, 2.0, true, 0.5, 2.5), Ok(SourceInterval { start: 11.0, end: 15.0 }));
    }

    #[test]
    fn refuses_intervals_outside_the_source() {
        assert!(source_interval(-1.0, 1.0, 1.0).is_err());
        assert!(source_interval(0.0, 0.0, 1.0).is_err());
        assert!(source_interval(0.0, 1.0, 5.0).is_err());
        assert!(slice_source_interval(0.0, 2.0, 1.0, false, 1.0, 1.0).is_err());
        // Reversed, a window longer than the clip would start before the source.
        assert!(slice_source_interval(0.0, 2.0, 1.0, true, -1.0, 4.0).is_err());
    }

    #[test]
    fn editable_rate_matches_ts() {
        assert_eq!(editable_rate(None), 1.0);
        assert_eq!(editable_rate(Some(&json!(null))), 1.0);
        assert_eq!(editable_rate(Some(&json!("2"))), 1.0);
        assert_eq!(editable_rate(Some(&json!(8))), 4.0);
        assert_eq!(editable_rate(Some(&json!(0.1))), 0.25);
        assert_eq!(editable_rate(Some(&json!(1.5))), 1.5);
    }

    #[test]
    fn truthiness_matches_js() {
        assert!(!js_truthy(None));
        assert!(!js_truthy(Some(&json!(""))));
        assert!(!js_truthy(Some(&json!(0))));
        assert!(js_truthy(Some(&json!("x"))));
        assert!(js_truthy(Some(&json!({}))));
    }
}
