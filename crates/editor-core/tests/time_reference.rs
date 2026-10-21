//! Time and evaluation against the TS reference values (task 4.3).
//!
//! `scripts/editor-time.test.ts` computes every case in
//! `packages/shared/src/editor/reference/time-and-evaluation.json` with the TS
//! implementations the engine replaces; this recomputes each one in Rust. Time
//! errors must carry the TS message word for word; an evaluation error must at
//! least be an error where the TS threw.

use std::path::Path;

use maleo_editor_core::keyframes::{evaluate_color_track, evaluate_value_track, retain_animation, retime_animation, sample_clip_transform};
use maleo_editor_core::source::{assert_source_interval, retime_source_duration, slice_source_interval, source_time};
use maleo_editor_core::time::*;
use serde_json::{Value, json};

fn reference() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor/reference/time-and-evaluation.json");
    serde_json::from_str(&std::fs::read_to_string(&path).expect("reference file")).expect("reference parses")
}

/// JSON equality as JavaScript sees it: object key order is irrelevant and a
/// number is its value.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(key, value)| y.get(key).is_some_and(|other| same(value, other))),
        _ => a == b,
    }
}

/// A numeric argument; the generator writes non-finite numbers as strings.
fn f(value: &Value) -> f64 {
    match value.as_str() {
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        Some(_) => f64::NAN,
        None => value.as_f64().unwrap_or(f64::NAN),
    }
}

fn base(spec: &Value) -> Result<Timebase, String> {
    timebase(rational(f(&spec[0]), f(&spec[1]))?, f(&spec[2]))
}

fn ratio(value: Rational) -> Value {
    json!([value.numerator, value.denominator])
}

fn rounded(value: Rounded) -> Value {
    json!({ "value": value.value, "exact": value.exact, "direction": value.direction.as_str() })
}

fn parts(value: TimecodeParts) -> Value {
    json!({ "hours": value.hours, "minutes": value.minutes, "seconds": value.seconds, "frames": value.frames, "dropFrame": value.drop_frame })
}

fn time_case(op: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |index: usize| &args[index];
    Ok(match op {
        "rational" => ratio(rational(f(arg(0)), f(arg(1)))?),
        "rationalCompare" => json!(rational_compare(rational(f(&arg(0)[0]), f(&arg(0)[1]))?, rational(f(&arg(1)[0]), f(&arg(1)[1]))?)),
        "rationalMultiply" => ratio(rational_multiply(rational(f(&arg(0)[0]), f(&arg(0)[1]))?, rational(f(&arg(1)[0]), f(&arg(1)[1]))?)?),
        "rationalDivide" => ratio(rational_divide(rational(f(&arg(0)[0]), f(&arg(0)[1]))?, rational(f(&arg(1)[0]), f(&arg(1)[1]))?)?),
        "frameRateFromLabel" => ratio(frame_rate_from_label(f(arg(0)))?),
        "timebase" => {
            let base = base(arg(0))?;
            json!({ "ticksPerSecond": ratio(base.ticks_per_second), "frameRate": ratio(base.frame_rate), "ticksPerFrame": base.ticks_per_frame })
        }
        "framesToProject" => json!(frames_to_ticks(f(arg(0)), base(arg(1))?)?),
        "timeToFrames" => rounded(ticks_to_frames(whole_ticks(f(arg(0)), "project")?, base(arg(1))?)),
        "secondsToProject" => {
            let rounded_ticks = seconds_to_ticks(f(arg(0)), base(arg(1))?)?;
            whole_ticks(rounded_ticks.value, "project")?;
            rounded(rounded_ticks)
        }
        "timeToExactSeconds" => ratio(ticks_to_exact_seconds(f(arg(0)), base(arg(1))?)?),
        "timeToSeconds" => json!(ticks_to_seconds(f(arg(0)), base(arg(1))?)?),
        "secondsRoundTrip" => {
            let base = base(arg(1))?;
            let ticks = frames_to_ticks(f(arg(0)), base)?;
            rounded(seconds_to_ticks(ticks_to_seconds(ticks, base)?, base)?)
        }
        "nudges" => {
            let base = base(arg(1))?;
            let frame = frames_to_ticks(1.0, base)?;
            let mut position = 0.0;
            for _ in 0..(f(arg(0)) as usize) {
                position += frame;
            }
            json!({ "ticks": position, "frames": rounded(ticks_to_frames(position, base)) })
        }
        "tenHours" => {
            let base = base(arg(0))?;
            let frames = maleo_editor_core::keyframes::js_round((base.frame_rate.numerator / base.frame_rate.denominator) * 36_000.0);
            let ticks = frames_to_ticks(frames, base)?;
            json!({ "frames": frames, "back": rounded(seconds_to_ticks(ticks_to_seconds(ticks, base)?, base)?), "ticks": ticks })
        }
        "sourceDurationToProject" => rounded(source_duration_to_project(whole_ticks(f(arg(0)), "source")?, base(arg(1))?, base(arg(2))?)?),
        "compareAcrossTimebases" => json!(compare_across_timebases(f(arg(0)), base(arg(1))?, f(arg(2)), base(arg(3))?)?),
        "framesToTimecodeParts" => parts(frames_to_timecode_parts(f(arg(0)), base(arg(1))?, arg(2).as_bool().unwrap_or(false))?),
        "formatTimecode" => json!(format_timecode(whole_ticks(f(arg(0)), "project")?, base(arg(1))?, arg(2).as_bool().unwrap_or(false))?),
        "timecodePartsToFrames" => {
            let p = arg(0);
            let parts = TimecodeParts {
                hours: f(&p["hours"]),
                minutes: f(&p["minutes"]),
                seconds: f(&p["seconds"]),
                frames: f(&p["frames"]),
                drop_frame: p["dropFrame"].as_bool().unwrap_or(false),
            };
            json!(timecode_parts_to_frames(parts, base(arg(1))?)?)
        }
        "parseTimecode" => json!(parse_timecode(arg(0).as_str().unwrap_or_default(), base(arg(1))?)?),
        other => panic!("unknown time op {other}"),
    })
}

fn evaluation_case(op: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |index: usize| &args[index];
    let error = |error: maleo_editor_core::EngineError| error.to_string();
    Ok(match op {
        "evaluateValueTrack" => json!(evaluate_value_track(arg(0).as_array().expect("keys"), f(arg(1)), f(arg(2)))),
        "evaluateColorTrack" => evaluate_color_track(arg(0).as_array().expect("keys"), f(arg(1))).map_err(error)?,
        "retainClipAnimation" => retain_animation(arg(0), f(arg(1)), f(arg(2))).map_err(error)?,
        "retimeClipAnimation" => retime_animation(arg(0), f(arg(1))).map_err(error)?,
        "sampleClipTransform" => {
            let [x, y, scale, rotation, opacity] = sample_clip_transform(Some(arg(0)).filter(|layout| !layout.is_null()), f(arg(1)));
            json!({ "xPct": x, "yPct": y, "scale": scale, "rotationDeg": rotation, "opacity": opacity })
        }
        "sourceTime" => json!(source_time(f(arg(0)), f(arg(1)), f(arg(2)), arg(3).as_bool().unwrap_or(false), f(arg(4))).map_err(error)?),
        "retimeSourceDuration" => json!(retime_source_duration(f(arg(0)), f(arg(1)), f(arg(2)), f(arg(3))).map_err(error)?),
        "assertSourceInterval" => {
            assert_source_interval(f(arg(0)), f(arg(1)), f(arg(2)), f(arg(3))).map_err(error)?;
            Value::Null
        }
        "sliceSourceInterval" => {
            let interval = slice_source_interval(f(arg(0)), f(arg(1)), f(arg(2)), arg(3).as_bool().unwrap_or(false), f(arg(4)), f(arg(5))).map_err(error)?;
            json!({ "start": interval.start, "end": interval.end })
        }
        other => panic!("unknown evaluation op {other}"),
    })
}

fn check(section: &str, exact_errors: bool, run: impl Fn(&str, &[Value]) -> Result<Value, String>) {
    let reference = reference();
    let cases = reference[section].as_array().expect("cases");
    assert!(cases.len() > 200, "{section}: {} cases", cases.len());
    for case in cases {
        let op = case["op"].as_str().expect("op");
        let args = case["args"].as_array().expect("args");
        let expected = &case["result"];
        let label = format!("{op} {}", Value::Array(args.clone()));
        match run(op, args) {
            Ok(value) => {
                let want = expected.get("ok").unwrap_or_else(|| panic!("{label}: TS threw {expected}, Rust returned {value}"));
                // JSON writes non-finite numbers as null.
                let value = if value.as_f64().is_none() && value.is_number() { Value::Null } else { value };
                assert!(same(&value, want), "{label}: Rust {value}, TS {want}");
            }
            Err(message) => {
                let want = expected.get("error").unwrap_or_else(|| panic!("{label}: Rust refused ({message}), TS returned {expected}"));
                if exact_errors {
                    assert_eq!(message, want.as_str().unwrap_or_default(), "{label}");
                }
            }
        }
    }
}

#[test]
fn time_conversions_match_the_ts_reference() {
    check("time", true, time_case);
}

#[test]
fn keyframe_and_retiming_values_match_the_ts_reference() {
    check("evaluation", false, evaluation_case);
}
