//! The inspector rules against `inspector-rules.reference.json`, recorded from
//! the TypeScript rules before they moved here. `inspector-rules.reference.test.ts`
//! holds the web functions to the same file.

use std::fs;
use std::path::Path;

use maleo_app_core::ops::apply_json;
use serde_json::{Value, json};

fn reference() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor/inspector-reference/inspector-rules.reference.json");
    serde_json::from_str(&fs::read_to_string(&path).expect("reference file")).expect("reference parses")
}

/// JSON equality as JavaScript sees it: key order is not significant, a number is its value.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(key, value)| y.get(key).is_some_and(|other| same(value, other))),
        _ => a == b,
    }
}

fn call(input: Value) -> Value {
    serde_json::from_str(&apply_json(None, &input.to_string()).unwrap_or_else(|error| panic!("{input}: {error}"))).expect("output parses")
}

/// Within two units in the last place. JavaScript engines disagree on `Math.log10`
/// by one ULP (V8 and JavaScriptCore use different ports), so a display value
/// derived from it cannot be pinned to one engine's bits. The stored gain
/// (`gainFromFader`) is held exactly.
fn near(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => (x - y).abs() <= 2.0 * f64::EPSILON * x.abs().max(y.abs()),
        _ => same(a, b),
    }
}

/// Every case of one function: build the op input from the case, compare with `expected(case)`.
fn check(name: &str, input: impl Fn(&Value) -> Value, expected: impl Fn(&Value) -> Value) {
    check_with(name, input, expected, same);
}

fn check_with(name: &str, input: impl Fn(&Value) -> Value, expected: impl Fn(&Value) -> Value, equal: fn(&Value, &Value) -> bool) {
    let reference = reference();
    let cases = reference[name].as_array().unwrap_or_else(|| panic!("{name} is recorded"));
    assert!(!cases.is_empty(), "{name} has cases");
    for case in cases {
        let got = call(input(case));
        assert!(equal(&got, &expected(case)), "{name}: {case}\n got {got}");
    }
}

fn out(case: &Value) -> Value {
    case["out"].clone()
}

#[test]
fn layout_and_text_defaults() {
    check("normalizeLayout", |c| json!({ "op": "layout.normalize", "kind": c["kind"], "layout": c["layout"] }), out);
    check("defaultTextStyle", |c| json!({ "op": "text.defaultStyle", "preset": c["preset"] }), out);
}

#[test]
fn fader_mapping() {
    check("gainFromFader", |c| json!({ "op": "fader.gain", "pct": c["pct"] }), out);
    check_with("faderFromGain", |c| json!({ "op": "fader.position", "gain": c["gain"] }), out, near);
    // The reference names `-Infinity`; the op answers `null`, which the wrapper reads as `-Infinity`.
    check_with("dbFromGain", |c| json!({ "op": "gain.db", "gain": c["gain"] }), |c| if c["out"] == "-Infinity" { Value::Null } else { out(c) }, near);
    check("formatGainDb", |c| json!({ "op": "gain.label", "gain": c["gain"] }), out);
}

#[test]
fn focal_point() {
    check("focalPointAt", |c| json!({ "op": "focal.at", "clientX": c["clientX"], "clientY": c["clientY"], "rect": c["rect"] }), out);
    check("nudgeFocalPoint", |c| json!({ "op": "focal.nudge", "point": c["point"], "key": c["key"] }), out);
}

#[test]
fn inspector_groups() {
    let options = |c: &Value| json!({ "videoHasAudio": c["opts"]["videoHasAudio"], "sceneHasVideo": c["opts"]["sceneHasVideo"] });
    check(
        "clipPropertyGroups",
        |c| json!({ "op": "groups", "kind": c["kind"], "options": options(c) }),
        |c| Value::Array(c["out"].as_array().expect("groups").iter().map(|g| g["k"].clone()).collect()),
    );
    // Recorded with the b-roll-with-audio options, as the TS case list chose.
    check(
        "activeClipPropertyGroup",
        |c| {
            let groups = call(json!({ "op": "groups", "kind": c["kind"], "options": { "videoHasAudio": true } }));
            json!({ "op": "groups.active", "groups": groups, "remembered": c["remembered"] })
        },
        out,
    );
    check(
        "clipGroupOptions",
        |c| {
            let kinds: Vec<Value> = c["sel"]["scene"]["visualClips"].as_array().into_iter().flatten().map(|v| v["kind"].clone()).collect();
            json!({ "op": "groups.options", "videoOverlayKind": c["sel"]["videoOverlay"]["kind"], "sceneVisualKinds": kinds })
        },
        // `brollKind` decides only an icon; the controller keeps it.
        |c| json!({ "videoHasAudio": c["out"]["videoHasAudio"], "sceneHasVideo": c["out"]["sceneHasVideo"] }),
    );
}

#[test]
fn inspector_subject() {
    check(
        "resolveClipSubject",
        |c| {
            let mut input = c["sel"].clone();
            input["op"] = json!("subject");
            input
        },
        // Titles and media URLs are presentation; the core decides the kind and the clip id.
        |c| match &c["out"] {
            Value::Null => Value::Null,
            subject => {
                let mut kept = serde_json::Map::new();
                kept.insert("kind".into(), subject["kind"].clone());
                if let Some(id) = subject.get("clipId") {
                    kept.insert("clipId".into(), id.clone());
                }
                Value::Object(kept)
            }
        },
    );
}

/// The key rules against `clip-keys.reference.json`: key target, the full
/// refusal message (the engine's wording after the colon matches zod's first
/// issue), near-key index and upsert.
#[test]
fn key_rules() {
    let editor = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor");
    let reference: Value =
        serde_json::from_str(&fs::read_to_string(editor.join("inspector-reference/clip-keys.reference.json")).expect("reference")).expect("parses");
    let scope_of = |name: &str| -> Value {
        if let Some(generated) = reference["generated"].get(name) {
            return generated.clone();
        }
        let (dir, file) = name.split_once('/').expect("dir/file");
        let path = if dir == "corpus" { editor.join("corpus/scopes").join(file) } else { editor.join("fixtures").join(dir).join(file) };
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).expect("scope file")).expect("parses");
        if dir == "corpus" { value } else { value["scope"].clone() }
    };
    let messages = reference["messages"].as_array().expect("messages");
    let properties = reference["properties"].as_array().expect("properties");
    let keysets = reference["keysets"].as_array().expect("keysets");
    let mut checked = 0;
    for target in reference["targets"].as_array().expect("targets") {
        let name = target["scope"].as_str().expect("scope");
        let scope = maleo_editor_core::admit_scope(&scope_of(name).to_string()).unwrap_or_else(|error| panic!("{name}: {error}"));
        let id = &target["id"];
        let got =
            serde_json::from_str::<Value>(&apply_json(Some(&scope), &json!({ "op": "keys.target", "id": id }).to_string()).expect("target")).expect("parses");
        assert!(same(&got, &target["target"]), "{name} {id}: target {got}");
        for (p, property) in properties.iter().enumerate() {
            for (k, keys) in keysets.iter().enumerate() {
                let recorded = target["errors"][p][k].as_i64().expect("index");
                let expected = if recorded < 0 { Value::Null } else { messages[recorded as usize].clone() };
                let input = json!({ "op": "keys.error", "id": id, "property": property, "keys": keys });
                let got: Value = serde_json::from_str(&apply_json(Some(&scope), &input.to_string()).expect("error op")).expect("parses");
                assert_eq!(got, expected, "{name} {id} {property} keyset {k}");
                checked += 1;
            }
        }
    }
    assert!(checked > 5000, "every recorded refusal ran");
    let track = &reference["track"];
    for case in reference["nearKeyIndex"].as_array().expect("near") {
        let got = call(json!({ "op": "keys.near", "keys": track, "time": case["time"], "snap": case["snap"] }));
        assert!(same(&got, &case["out"]), "near {case}");
    }
    for case in reference["upsertKey"].as_array().expect("upsert") {
        let got = call(json!({ "op": "keys.upsert", "keys": track, "time": case["time"], "value": 7, "easing": case["easing"] }));
        assert!(same(&got, &case["out"]), "upsert {case}\n got {got}");
    }
}
