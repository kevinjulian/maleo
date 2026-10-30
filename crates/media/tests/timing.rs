use maleo_media::timing::*;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Operation {
    Interval { start: f64, duration: f64, rate: f64 },
    Slice { start: f64, duration: f64, rate: f64, reverse: bool, from: f64, to: f64 },
    Time { start: f64, duration: f64, rate: f64, reverse: bool, elapsed: f64 },
    Retime { start: f64, duration: f64, previous: f64, next: f64 },
    Scene { selected: f64, scene: f64, preserve: bool },
    Hold { duration: f64, rate: f64, fps: f64, frame: f64 },
    Reverse { url: String, start: f64, duration: f64, rate: f64, reverse: bool, derivative: Option<ReverseMedia>, revision: Option<String> },
}
#[derive(Deserialize)]
struct Case {
    name: String,
    operation: Operation,
    expected: Value,
}
fn result(operation: Operation) -> Result<Value, String> {
    Ok(match operation {
        Operation::Interval { start, duration, rate } => serde_json::to_value(source_interval(start, duration, rate)?).unwrap(),
        Operation::Slice { start, duration, rate, reverse, from, to } => {
            serde_json::to_value(slice_source_interval(start, duration, rate, reverse, from, to)?).unwrap()
        }
        Operation::Time { start, duration, rate, reverse, elapsed } => json!(source_time(start, duration, rate, reverse, elapsed)?),
        Operation::Retime { start, duration, previous, next } => json!(retime_source_duration(start, duration, previous, next)?),
        Operation::Scene { selected, scene, preserve } => json!(scene_visual_source_duration(selected, scene, preserve)),
        Operation::Hold { duration, rate, fps, frame } => json!(held_frame(duration, rate, fps, frame)?),
        Operation::Reverse { url, start, duration, rate, reverse, derivative, revision } => {
            serde_json::to_value(reverse_playback_source(&url, start, duration, rate, reverse, derivative.as_ref(), revision.as_deref())?).unwrap()
        }
    })
}
fn equal(name: &str, actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => assert!((a.as_f64().unwrap() - b.as_f64().unwrap()).abs() <= 1e-12, "{name}: {actual} != {expected}"),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{name}");
            for (a, b) in a.iter().zip(b) {
                equal(name, a, b);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{name}");
            for (key, value) in a {
                equal(name, value, b.get(key).expect("expected field"));
            }
        }
        _ => assert_eq!(actual, expected, "{name}"),
    }
}
#[test]
fn shared_timing_fixtures_match_production_typescript_semantics() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("fixtures/timing.json")).unwrap();
    assert!(cases.len() >= 60);
    for case in cases {
        let actual = match result(case.operation) {
            Ok(value) => json!({"ok":value}),
            Err(_) => json!({"error":true}),
        };
        equal(&case.name, &actual, &case.expected);
    }
}
#[test]
fn malformed_and_non_finite_requests_are_refused() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(source_interval(value, 1.0, 1.0).is_err());
        assert!(held_frame(1.0, 1.0, 30.0, value).is_err());
    }
    assert!(source_time(0.0, 1.0, 1.0, false, f64::NAN).unwrap().is_nan());
}
