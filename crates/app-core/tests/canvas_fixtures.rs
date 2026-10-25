//! The engine's canvas rules against what the TypeScript computed
//! (`tests/fixtures/canvas.json`, `p2-preview-editing` D4), within 1e-9.

use maleo_app_core::canvas::edit::{LayoutPatch, edit_command, resolve};
use maleo_app_core::canvas::gesture::{Arrow, Corner, Mode, corner_patch, move_patch, nudge_patch, resize_canvas_layout, resize_value, rotate_patch};
use maleo_app_core::canvas::mask::{MaskRegion, mask_box, mask_from_box};
use maleo_app_core::canvas::{Frame, Guides, Patch, Point, Size, Target};
use maleo_editor_core::schema::EditScope;
use serde_json::{Map, Value};

fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/canvas.json")).expect("fixture JSON")
}

/// Equal within 1e-9, with an absent `motion` equal to `motion: null` (the TS
/// normalizes every visual of a scene it rebuilds; the engine only the one it edits).
fn close(a: &Value, b: &Value, path: &str) -> Result<(), String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap_or(f64::NAN), y.as_f64().unwrap_or(f64::NAN));
            if (x - y).abs() <= 1e-9 { Ok(()) } else { Err(format!("{path}: {x} != {y}")) }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Err(format!("{path}: {} items != {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().try_for_each(|(i, (x, y))| close(x, y, &format!("{path}[{i}]")))
        }
        (Value::Object(x), Value::Object(y)) => {
            let keys: Vec<&String> = x.keys().chain(y.keys().filter(|k| !x.contains_key(*k))).collect();
            for key in keys {
                let (l, r) = (x.get(key), y.get(key));
                match (l, r) {
                    (Some(l), Some(r)) => close(l, r, &format!("{path}.{key}"))?,
                    (None, Some(Value::Null)) | (Some(Value::Null), None) if key == "motion" => {}
                    _ => return Err(format!("{path}.{key}: {l:?} != {r:?}")),
                }
            }
            Ok(())
        }
        _ if a == b => Ok(()),
        _ => Err(format!("{path}: {a} != {b}")),
    }
}

fn steps(command: &Value) -> Vec<Value> {
    match command.get("type").and_then(Value::as_str) {
        Some("batch") => command["commands"].as_array().cloned().unwrap_or_default(),
        Some("noop") => Vec::new(),
        _ => vec![command.clone()],
    }
}

#[test]
fn edit_commands_match_the_typescript() {
    let fixtures = fixtures();
    let cases = fixtures["edits"].as_array().expect("edits");
    assert!(cases.len() >= 20);
    for case in cases {
        let name = case["name"].as_str().unwrap_or_default();
        let scope: EditScope = maleo_editor_core::admit_scope(&case["scope"].to_string()).expect("scope admits");
        let target = Target::from_value(&case["target"]).expect("target");
        let patch = LayoutPatch::set(case["patch"].as_object().cloned().unwrap_or_default());
        let engine = edit_command(&scope, &target, &patch, case.get("at").and_then(Value::as_f64));
        let ours = steps(&engine);
        let replaced: Vec<&str> = ours.iter().filter(|s| s["type"] == "clip.replace").filter_map(|s| s["id"].as_str()).collect();
        // A TS replace of a clip the engine leaves alone may only normalize it.
        let mut theirs = Vec::new();
        for step in steps(&case["command"]) {
            let id = step["id"].as_str().unwrap_or_default();
            if step["type"] == "clip.replace" && !replaced.contains(&id) {
                let prior = scope.doc.clips.iter().find(|c| c.id == id).map(|c| serde_json::to_value(&**c).expect("clip"));
                close(&step["clip"], &prior.unwrap_or(Value::Null), &format!("{name}: untouched {id}")).unwrap_or_else(|e| panic!("{e}"));
                continue;
            }
            theirs.push(step);
        }
        close(&Value::Array(ours), &Value::Array(theirs), name).unwrap_or_else(|e| panic!("{e}\nengine: {engine}"));
        // The resolved layout before the edit, as `canvasClipLayout` read it.
        let resolved = resolve(&scope, &target);
        let expected = &case["layout"];
        let layout = resolved.as_ref().and_then(|r| r.layout.clone()).map_or(Value::Null, Value::Object);
        close(&layout, expected.get("layout").unwrap_or(&Value::Null), &format!("{name}: layout")).unwrap_or_else(|e| panic!("{e}"));
        if let Some(r) = &resolved {
            close(&serde_json::json!([r.start, r.duration]), &serde_json::json!([expected["start"], expected["duration"]]), &format!("{name}: timing"))
                .unwrap_or_else(|e| panic!("{e}"));
        }
    }
}

fn frame(value: &Value) -> Frame {
    Frame::of(value.as_object().expect("a layout"))
}

fn size(value: &Value) -> Size {
    let read = |a: &str, b: &str| value.get(a).or_else(|| value.get(b)).and_then(Value::as_f64).expect("a size");
    Size { w: read("width", "w"), h: read("height", "h") }
}

fn patch_value(patch: Patch) -> Value {
    Value::Object(patch.to_map())
}

fn guides_value(guides: Guides) -> Value {
    guides.to_value()
}

fn check(name: &str, ours: Value, theirs: &Value) {
    close(&ours, theirs, name).unwrap_or_else(|e| panic!("{e}"));
}

#[test]
fn gestures_match_the_typescript() {
    let fixtures = fixtures();
    let flag = |c: &Value, key: &str| c[key].as_bool().unwrap_or(false);
    let n = |c: &Value, key: &str| c[key].as_f64().expect("a number");
    for c in fixtures["moves"].as_array().expect("moves") {
        let (patch, guides) = move_patch(frame(&c["init"]), n(c, "dx"), n(c, "dy"), size(&c["box"]), n(c, "scale"), flag(c, "alt"));
        let name = format!("move {}", c["name"]);
        check(&name, patch_value(patch), &c["patch"]);
        check(&name, guides_value(guides), &c["guides"]);
    }
    for c in fixtures["rotations"].as_array().expect("rotations") {
        let origin = Point { x: n(&c["box"], "left"), y: n(&c["box"], "top") };
        let local = |p: &Value| Point { x: n(p, "x") - origin.x, y: n(p, "y") - origin.y };
        let patch = rotate_patch(frame(&c["init"]), size(&c["box"]), local(&c["start"]), local(&c["at"]), flag(c, "alt"));
        check(&format!("rotate {}", c["name"]), patch_value(patch), &c["patch"]);
    }
    for c in fixtures["corners"].as_array().expect("corners") {
        let Some(Mode::Resize(corner)) = Mode::parse(c["corner"].as_str().unwrap_or_default()) else { panic!("a corner") };
        let (patch, guides) = corner_patch(frame(&c["init"]), corner, n(c, "dx"), n(c, "dy"), size(&c["box"]), n(c, "scale"), flag(c, "alt"), flag(c, "shift"));
        let name = format!("corner {}", c["name"]);
        check(&name, patch_value(patch), &c["patch"]);
        check(&name, guides_value(guides), &c["guides"]);
    }
    let nudges = fixtures["nudges"].as_array().expect("nudges");
    assert_eq!(nudges.len(), 48);
    for c in nudges {
        let mode = Mode::parse(c["mode"].as_str().unwrap_or_default()).expect("a mode");
        let key = Arrow::parse(c["key"].as_str().unwrap_or_default()).expect("an arrow");
        check(&format!("nudge {c}"), patch_value(nudge_patch(frame(&c["init"]), mode, key, flag(c, "shift"))), &c["patch"]);
    }
    for c in fixtures["resizes"].as_array().expect("resizes") {
        let patch = resize_value(frame(&c["init"]), c["axis"] == "heightPct", n(c, "value"));
        check(&format!("resize {c}"), patch_value(patch), &c["patch"]);
    }
    for c in fixtures["canvasResizes"].as_array().expect("canvas resizes") {
        let Some(Mode::Resize(corner)) = Mode::parse(c["corner"].as_str().unwrap_or_default()) else { panic!("a corner") };
        let _: Corner = corner;
        let patch =
            resize_canvas_layout(frame(&c["init"]), corner, n(c, "dx"), n(c, "dy"), size(&c["canvas"]), flag(c, "lock"), flag(c, "snap"), n(c, "scale"));
        check(&format!("resizeCanvasLayout {c}"), patch_value(patch), &c["patch"]);
    }
}

fn frame_value(f: Frame) -> Value {
    serde_json::json!({ "xPct": f.x, "yPct": f.y, "widthPct": f.w, "heightPct": f.h, "rotationDeg": f.rotation })
}

fn region_value(m: MaskRegion) -> Value {
    serde_json::json!({ "xPct": m.x, "yPct": m.y, "widthPct": m.w, "heightPct": m.h, "rotationDeg": m.rotation })
}

fn only_box_fields(value: &Value) -> Value {
    let keys = ["xPct", "yPct", "widthPct", "heightPct", "rotationDeg"];
    Value::Object(
        value.as_object().expect("an object").iter().filter(|(k, _)| keys.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect::<Map<_, _>>(),
    )
}

#[test]
fn mask_boxes_match_the_typescript() {
    let fixtures = fixtures();
    for c in fixtures["masks"].as_array().expect("masks") {
        let layout = frame(&c["layout"]);
        let canvas = size(&c["canvas"]);
        let scale = c["scale"].as_f64().expect("scale");
        let mask = MaskRegion::of(&c["mask"]).expect("mask");
        check("mask box", frame_value(mask_box(layout, mask, canvas, scale)), &only_box_fields(&c["box"]));
        check("mask from moved", region_value(mask_from_box(layout, frame(&c["moved"]), canvas, scale)), &only_box_fields(&c["fromMoved"]));
        let mut wide = c["box"].clone();
        wide["xPct"] = 200.into();
        wide["widthPct"] = 500.into();
        check("mask clamped", region_value(mask_from_box(layout, frame(&wide), canvas, scale)), &only_box_fields(&c["clamped"]));
    }
}
