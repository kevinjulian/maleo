//! Source timing: where in the original media a clip's window reads from.
//!
//! A line-for-line port of `packages/shared/src/source-interval.ts`. The
//! arithmetic is f64 in the same order as the TS, so results are bit-identical
//! (design decision 4): reorder nothing here without changing both.

use serde_json::Value;

use crate::error::{EngineError, EngineResult};

/// Seconds in original source, independent of playback direction.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SourceInterval {
    pub start: f64,
    pub end: f64,
}

/// `sourceInterval(start, duration, rate)`.
pub fn source_interval(start: f64, duration: f64, rate: f64) -> EngineResult<SourceInterval> {
    if ![start, duration, rate].iter().all(|value| value.is_finite()) || start < 0.0 || duration <= 0.0 || !(0.25..=4.0).contains(&rate) {
        return Err(EngineError::InvalidSourceInterval(format!("start {start}, duration {duration}, rate {rate}")));
    }
    Ok(SourceInterval { start, end: start + duration * rate })
}

/// `sliceSourceInterval(start, duration, rate, reverse, from, to)`: the
/// retained timeline window `from..to`, as original-source seconds even when
/// the clip plays reversed.
pub fn slice_source_interval(start: f64, duration: f64, rate: f64, reverse: bool, from: f64, to: f64) -> EngineResult<SourceInterval> {
    source_interval(start, duration, rate)?;
    if !from.is_finite() || !to.is_finite() || to <= from {
        return Err(EngineError::InvalidSourceInterval(format!("retained window {from}..{to}")));
    }
    let next_start = start + (if reverse { duration - to } else { from }) * rate;
    if next_start < -0.000001 {
        return Err(EngineError::InvalidSourceInterval(format!("window starts before the source ({next_start})")));
    }
    source_interval(next_start.max(0.0), to - from, rate)
}

/// `assertSourceInterval(start, duration, rate, sourceDuration)`: the selected
/// range fits inside media of `source_duration` seconds.
pub fn assert_source_interval(start: f64, duration: f64, rate: f64, source_duration: f64) -> EngineResult<()> {
    let interval = source_interval(start, duration, rate)?;
    if !source_duration.is_finite() || source_duration <= 0.0 || interval.end > source_duration + 0.000001 {
        return Err(EngineError::InvalidSourceInterval("Replacement source is too short for selected clip range".to_owned()));
    }
    Ok(())
}

/// `sourceTime(start, duration, rate, reverse, elapsed)`: the source second
/// shown `elapsed` timeline seconds in; reverse reads from the far boundary.
pub fn source_time(start: f64, duration: f64, rate: f64, reverse: bool, elapsed: f64) -> EngineResult<f64> {
    let interval = source_interval(start, duration, rate)?;
    let offset = crate::keyframes::js_min(duration, crate::keyframes::js_max(0.0, elapsed)) * rate;
    Ok(if reverse { interval.end - offset } else { interval.start + offset })
}

/// `retimeSourceDuration(start, duration, previousRate, nextRate)`: a rate edit
/// keeps the source endpoints and changes the timeline duration.
pub fn retime_source_duration(start: f64, duration: f64, previous_rate: f64, next_rate: f64) -> EngineResult<f64> {
    let selected = source_interval(start, duration, previous_rate)?;
    source_interval(start, duration, next_rate)?;
    Ok((selected.end - selected.start) / next_rate)
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
