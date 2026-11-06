//! The animation edits against `clip-animation-edit.reference.json`, recorded
//! from `clip-animation-edit.ts` before it moved here. The grid below rebuilds
//! the TS reference suite's inputs in its order
//! (`clip-animation-edit.reference.test.ts`).

use std::fs;
use std::path::{Path, PathBuf};

use maleo_app_core::ops::apply_json;
use maleo_editor_core::{EditScope, admit_scope};
use serde_json::{Value, json};

fn editor() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("parses")
}

/// JSON equality as JavaScript sees it: key order is not significant, a number is its value.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|o| same(v, o))),
        _ => a == b,
    }
}

fn op(scope: &EditScope, input: Value) -> Value {
    serde_json::from_str(&apply_json(Some(scope), &input.to_string()).unwrap_or_else(|e| panic!("{input}: {e}"))).expect("parses")
}

/// An edit's answer as the TS reference recorded it: `{ok}` or `{error}`.
fn attempt(answer: Value) -> Value {
    match answer.get("command") {
        Some(command) => json!({ "ok": command }),
        None => answer,
    }
}

fn check(name: &str, got: &[Value], expected: &Value) {
    let expected = expected.as_array().unwrap_or_else(|| panic!("{name} is recorded"));
    assert_eq!(got.len(), expected.len(), "{name}: case count");
    for (index, (got, expected)) in got.iter().zip(expected).enumerate() {
        assert!(same(got, expected), "{name}[{index}]\n got {got}\n expected {expected}");
    }
}

fn scope_of(keys: &Value, name: &str) -> EditScope {
    let value = match keys["generated"].get(name) {
        Some(generated) => generated.clone(),
        None => {
            let (dir, file) = name.split_once('/').expect("dir/file");
            if dir == "corpus" {
                read(&editor().join("corpus/scopes").join(file))
            } else {
                read(&editor().join("fixtures").join(dir).join(file))["scope"].clone()
            }
        }
    };
    admit_scope(&value.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"))
}

const ROWS: [&[&str]; 5] = [&["xPct", "yPct"], &["opacity"], &["volume"], &["fontSize"], &["scale", "rotationDeg"]];

fn target_cases(scope: &EditScope, case: &Value) {
    let target = &case["target"];
    let label = format!("{} {}", case["scope"], case["id"]);
    assert!(same(&op(scope, json!({ "op": "anim.clipId", "target": target })), &case["clipId"]), "{label}: clipId");
    let info = op(scope, json!({ "op": "anim.info", "target": target }));
    assert!(same(&info, &case["info"]), "{label}: info\n got {info}\n expected {}", case["info"]);
    if info.is_null() {
        return;
    }
    let d = info["duration"].as_f64().expect("duration");
    let start = info["start"].as_f64().expect("start");
    let mut properties: Vec<String> = info["properties"].as_array().expect("properties").iter().map(|p| p.as_str().expect("name").to_owned()).collect();
    if !properties.iter().any(|p| p == "volume") {
        properties.push("volume".to_owned());
    }
    let edits: Vec<Value> = properties
        .iter()
        .flat_map(|property| {
            [-0.1, 0.05, d / 2.0, d + 0.1].into_iter().flat_map(move |time| {
                [json!({}), json!({ "value": 0.3, "easing": "in" })].into_iter().map(move |extra| {
                    let mut input = json!({ "op": "anim.key.edit", "target": target, "property": property, "time": time });
                    input.as_object_mut().expect("object").extend(extra.as_object().expect("object").clone());
                    input
                })
            })
        })
        .map(|input| attempt(op(scope, input)))
        .collect();
    check(&format!("{label}: edit"), &edits, &case["edit"]);
    let animation = &info["animation"];
    let keyed: Vec<&str> = info["properties"]
        .as_array()
        .expect("properties")
        .iter()
        .filter_map(Value::as_str)
        .filter(|p| animation["tracks"][*p].as_array().is_some_and(|k| !k.is_empty()))
        .collect();
    let removes: Vec<Value> = keyed
        .iter()
        .flat_map(|p| [0, 99].map(|index| attempt(op(scope, json!({ "op": "anim.key.remove", "target": target, "property": p, "index": index })))))
        .collect();
    check(&format!("{label}: remove"), &removes, &case["remove"]);
    let moves: Vec<Value> = keyed
        .iter()
        .flat_map(|p| {
            [0.2, -1.0, d].map(|time| attempt(op(scope, json!({ "op": "anim.key.move", "target": target, "property": p, "index": 0, "time": time }))))
        })
        .collect();
    check(&format!("{label}: move"), &moves, &case["move"]);
    let moments = op(scope, json!({ "op": "anim.moments", "animation": animation }));
    assert!(same(&moments, &case["moments"]), "{label}: moments\n got {moments}");
    let times: Vec<f64> = moments.as_array().expect("moments").iter().map(|m| m["time"].as_f64().expect("time")).collect();
    let selections: [Vec<f64>; 3] = [times.clone(), times.iter().take(1).copied().collect(), Vec::new()];
    let moved: Vec<Value> = selections
        .iter()
        .flat_map(|selected| {
            [None, Some(0.25), Some(-100.0), Some(100.0)].map(|delta| {
                let mut input = json!({ "op": "anim.moments.move", "target": target, "times": selected });
                if let Some(delta) = delta {
                    input["delta"] = json!(delta);
                }
                attempt(op(scope, input))
            })
        })
        .collect();
    check(&format!("{label}: moveMoments"), &moved, &case["moveMoments"]);
    let from = times.first().copied().unwrap_or(0.0);
    let moved_one: Vec<Value> = [None, Some(0.4), Some(-1.0), Some(d + 1.0)]
        .map(|to| {
            let mut input = json!({ "op": "anim.moment.move", "target": target, "from": from });
            if let Some(to) = to {
                input["to"] = json!(to);
            }
            attempt(op(scope, input))
        })
        .to_vec();
    check(&format!("{label}: moveMoment"), &moved_one, &case["moveMoment"]);
    let eased: Vec<Value> = [None, keyed.first().copied(), Some("fill")]
        .map(|property| {
            let mut input = json!({ "op": "anim.moments.easing", "target": target, "times": times, "easing": "hold" });
            if let Some(property) = property {
                input["property"] = json!(property);
            }
            attempt(op(scope, input))
        })
        .to_vec();
    check(&format!("{label}: easing"), &eased, &case["easing"]);
    let easings: Vec<Value> = times.iter().map(|time| op(scope, json!({ "op": "anim.moment.easings", "animation": animation, "time": time }))).collect();
    check(&format!("{label}: momentEasings"), &easings, &case["momentEasings"]);
    let edges: Vec<Value> = ["in", "out"]
        .into_iter()
        .flat_map(|edge| ["none", "fade", "slide", "zoom"].into_iter().flat_map(move |preset| [0.5, d * 2.0].map(move |seconds| (edge, preset, seconds))))
        .map(|(edge, preset, seconds)| attempt(op(scope, json!({ "op": "anim.edge", "target": target, "edge": edge, "preset": preset, "seconds": seconds }))))
        .collect();
    check(&format!("{label}: edge"), &edges, &case["edge"]);
    let zero = attempt(op(scope, json!({ "op": "anim.edge", "target": target, "edge": "in", "preset": "fade", "seconds": 0 })));
    assert!(same(&zero, &case["edgeZero"]), "{label}: edgeZero {zero}");
    let states: Vec<Value> = ["in", "out"]
        .map(|edge| {
            op(scope, json!({ "op": "anim.edge.state", "animation": animation, "edge": edge, "duration": d, "values": info["values"], "audio": info["audio"] }))
        })
        .to_vec();
    check(&format!("{label}: edgeState"), &states, &case["edgeState"]);
    let rows: Vec<Value> = ROWS
        .iter()
        .flat_map(|properties| [start - 1.0, start, start + d / 3.0, start + d].map(move |absolute| (properties, absolute)))
        .map(|(properties, absolute)| {
            let base = json!({ "target": target, "properties": properties, "absolute": absolute, "fps": 30 });
            let with = |name: &str, extra: Value| {
                let mut input = base.clone();
                input["op"] = json!(name);
                if let Some(values) = extra.get("values") {
                    input["values"] = values.clone();
                }
                op(scope, input)
            };
            let state = with("anim.row", json!({}));
            if state.is_null() {
                return Value::Null;
            }
            let mut out = state.as_object().expect("row").clone();
            out.insert("toggle".into(), attempt(with("anim.row.toggle", json!({}))));
            out.insert("set".into(), attempt(with("anim.row.set", json!({ "values": { properties[0]: 12 } }))));
            Value::Object(out)
        })
        .collect();
    check(&format!("{label}: rows"), &rows, &case["rows"]);
}

#[test]
fn animation_edits_match_the_reference() {
    let keys = read(&editor().join("inspector-reference/clip-keys.reference.json"));
    let reference = read(&editor().join("inspector-reference/clip-animation-edit.reference.json"));
    let mut clipboards: std::collections::BTreeMap<String, Value> = std::collections::BTreeMap::new();
    let mut checked = 0;
    for case in reference["cases"].as_array().expect("cases") {
        let name = case["scope"].as_str().expect("scope");
        let scope = scope_of(&keys, name);
        if case.get("paste").is_some() {
            let clipboard = clipboards.get(name).unwrap_or_else(|| panic!("{name}: no clipboard"));
            let target = op(&scope, json!({ "op": "anim.target.forId", "id": case["id"] }));
            let got = attempt(op(&scope, json!({ "op": "anim.paste", "target": target, "clipboard": clipboard })));
            assert!(same(&got, &case["paste"]), "{name} {}: paste\n got {got}\n expected {}", case["id"], case["paste"]);
        } else {
            let target = op(&scope, json!({ "op": "anim.target.forId", "id": case["id"] }));
            assert!(same(&target, &case["target"]), "{name} {}: target {target}", case["id"]);
            target_cases(&scope, case);
            let animation = &case["info"]["animation"];
            let keyed = animation.get("tracks").and_then(Value::as_object).is_some_and(|t| t.values().any(|k| k.as_array().is_some_and(|k| !k.is_empty())))
                || animation.get("colorTracks").and_then(Value::as_object).is_some_and(|t| t.values().any(|k| k.as_array().is_some_and(|k| !k.is_empty())));
            if keyed && !clipboards.contains_key(name) {
                clipboards.insert(name.to_owned(), animation.clone());
            }
        }
        checked += 1;
    }
    assert!(checked > 40, "every case ran");
    for entry in reference["selections"].as_array().expect("selections") {
        let scope = scope_of(&keys, entry["scope"].as_str().expect("scope"));
        let got = op(&scope, json!({ "op": "anim.target.selected", "selection": entry["selection"], "choice": entry["choice"] }));
        assert!(same(&got, &entry["out"]), "selection {entry}\n got {got}");
    }
}
