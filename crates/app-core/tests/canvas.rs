//! Rust twins of `canvas-transform.test.ts` and `clip-mask-canvas.test.ts`,
//! and the `canvas-editing` scenarios run through a canvas session.

use maleo_app_core::canvas::edit::{LayoutPatch, edit_command, normalize_layout, patch_clips, resize_value, resolve, sampled_layout};
use maleo_app_core::canvas::gesture::{Corner, resize_canvas_layout};
use maleo_app_core::canvas::{Frame, Size, Source, Target};
use maleo_editor_core::command::admit_command_value;
use maleo_editor_core::schema::EditScope;
use maleo_editor_core::{admit_scope, execute};
use serde_json::{Map, Value, json};

/// A document from the fixture file, by the name of the edit case that uses it.
fn fixture_scope(case: &str) -> EditScope {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/canvas.json")).expect("fixtures");
    let found = fixtures["edits"].as_array().expect("edits").iter().find(|c| c["name"] == case).unwrap_or_else(|| panic!("no case {case}"));
    admit_scope(&found["scope"].to_string()).expect("admits")
}

fn with_flags(scope: &EditScope, flags: Value) -> EditScope {
    let mut value = serde_json::to_value(scope).expect("scope");
    value["doc"]["trackFlags"] = flags;
    admit_scope(&value.to_string()).expect("admits")
}

fn run(scope: &EditScope, command: &Value) -> (EditScope, Value) {
    let executed = execute(scope, &admit_command_value(command.clone()).expect("admits")).expect("executes");
    (executed.scope, serde_json::to_value(&executed.inverse).expect("inverse"))
}

fn patch(value: Value) -> LayoutPatch {
    LayoutPatch::set(value.as_object().cloned().unwrap_or_default())
}

fn layout_of(scope: &EditScope, target: &Target) -> Map<String, Value> {
    resolve(scope, target).and_then(|r| r.layout).expect("a layout")
}

/// Two values as `JSON.stringify` writes them, so `2` and `2.0` are equal.
fn js(value: &Value) -> String {
    maleo_editor_core::json::to_js_string(value).expect("serializes")
}

macro_rules! assert_js {
    ($a:expr, $b:expr $(, $m:expr)?) => {
        assert_eq!(js(&$a), js(&$b) $(, "{}", $m)?)
    };
}

fn video(id: f64) -> Target {
    Target::new(Source::Video, id)
}

fn text(id: f64) -> Target {
    Target::new(Source::Text, id)
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-8
}

// ── canvas-transform.test.ts ──

#[test]
fn rotated_resize_keeps_opposite_corner_fixed_and_aspect_lock_preserves_ratio() {
    let initial = Frame { x: 10.0, y: 20.0, w: 40.0, h: 30.0, rotation: 90.0, aspect_locked: true };
    let canvas = Size { w: 800.0, h: 450.0 };
    let resized = initial.with(&resize_canvas_layout(initial, Corner::Se, -20.0, 40.0, canvas, true, false, 1.0));
    let corner = |l: Frame| {
        let (w, h) = (l.w * canvas.w / 100.0, l.h * canvas.h / 100.0);
        (l.x * canvas.w / 100.0 + w / 2.0 + h / 2.0, l.y * canvas.h / 100.0 + h / 2.0 - w / 2.0)
    };
    let (before, after) = (corner(initial), corner(resized));
    assert!(close(before.0, after.0) && close(before.1, after.1));
    assert!(close(resized.w / resized.h, initial.w / initial.h));
    let mut locked = Map::new();
    locked.insert("widthPct".into(), json!(40));
    locked.insert("heightPct".into(), json!(30));
    locked.insert("aspectLocked".into(), json!(true));
    assert_eq!(resize_value(&locked, false, 80.0), json!({ "widthPct": 80.0, "heightPct": 60.0 }).as_object().cloned().expect("map"));
    let minimum = resize_canvas_layout(initial, Corner::Nw, 10000.0, -10000.0, canvas, true, false, 1.0);
    assert!(minimum.w.expect("w") >= 2.0 && minimum.h.expect("h") >= 2.0);
}

#[test]
fn a_commit_merges_live_data_undoes_once_and_refuses_locks() {
    let scope = fixture_scope("static text rotation");
    let target = text(1.0);
    let original = scope.clone();
    let previewed = patch_clips(&scope, &target, &patch(json!({ "rotationDeg": 45, "aspectLocked": true }))).expect("patches");
    assert_eq!(scope, original, "a preview does not change the document");
    assert_eq!(previewed[0].payload("text").and_then(|t| t["layout"]["rotationDeg"].as_f64()), Some(45.0));
    // Live data another writer changed survives the commit.
    let mut value = serde_json::to_value(&scope).expect("scope");
    for clip in value["doc"]["clips"].as_array_mut().expect("clips") {
        if clip["id"] == "text:1" {
            clip["text"]["content"] = json!("Agent update");
        }
    }
    let live = admit_scope(&value.to_string()).expect("admits");
    let command = edit_command(&live, &target, &patch(json!({ "rotationDeg": 60, "aspectLocked": true })), None);
    assert_eq!(command["type"], "clip.replace");
    let (after, inverse) = run(&live, &command);
    let clip = after.doc.clips.iter().find(|c| c.id == "text:1").expect("text");
    assert_eq!(clip.payload("text").and_then(|t| t["content"].as_str()), Some("Agent update"));
    assert_eq!(after.doc.clips.iter().find(|c| c.id == "video:2"), live.doc.clips.iter().find(|c| c.id == "video:2"));
    assert_eq!(run(&after, &inverse).0, live, "one undo restores");
    let locked = with_flags(&scope, json!({ "0": { "locked": true } }));
    assert_eq!(edit_command(&locked, &target, &patch(json!({ "rotationDeg": 90 })), None), json!({ "type": "noop" }));
    assert_eq!(edit_command(&scope, &text(99.0), &patch(json!({ "rotationDeg": 90 })), None), json!({ "type": "noop" }));
}

#[test]
fn source_crop_and_flips_persist_reject_invalid_windows_and_reset_in_one_undo() {
    let scope = fixture_scope("crop and flips on an overlay");
    let crop = json!({ "xPct": 25, "yPct": 0, "widthPct": 50, "heightPct": 100 });
    for (target, track, url) in [(video(2.0), "1", "image.png"), (Target::new(Source::Scene, 1.0), "-1", "image.png")] {
        let command = edit_command(&scope, &target, &patch(json!({ "crop": crop, "flipX": true, "flipY": true })), None);
        let (edited, _) = run(&scope, &command);
        let layout = layout_of(&edited, &target);
        assert_eq!((&layout["crop"], &layout["flipX"], &layout["flipY"]), (&crop, &json!(true), &json!(true)));
        let clip = edited.doc.clips.iter().find(|c| c.id == resolve(&edited, &target).expect("resolves").clip_id).expect("clip");
        let source = clip.payload("video").map(|v| &v["url"]).or_else(|| clip.payload("scene").map(|s| &s["src"]));
        assert_eq!(source, Some(&json!(url)));
        let mut wide = crop.clone();
        wide["widthPct"] = json!(90);
        assert_eq!(edit_command(&edited, &target, &patch(json!({ "crop": wide })), None), json!({ "type": "noop" }));
        let mut flags = Map::new();
        flags.insert(track.to_owned(), json!({ "locked": true }));
        let locked = with_flags(&edited, Value::Object(flags));
        assert_eq!(edit_command(&locked, &target, &patch(json!({ "flipX": false })), None), json!({ "type": "noop" }));
        let reset = LayoutPatch { set: json!({ "flipX": false, "flipY": false }).as_object().cloned().expect("map"), unset: vec!["crop".into()] };
        let (restored, inverse) = run(&edited, &edit_command(&edited, &target, &reset, None));
        let layout = layout_of(&restored, &target);
        assert!(!layout.contains_key("crop"));
        assert_eq!(layout["flipX"], json!(false));
        assert_eq!(run(&restored, &inverse).0, edited);
    }
}

#[test]
fn animated_boxes_sample_clip_local_values_and_edits_key_the_current_frame() {
    let scope = fixture_scope("keyed scene visual");
    for target in [Target::new(Source::Scene, 1.0), video(2.0)] {
        let read = resolve(&scope, &target).expect("resolves");
        let (sampled, scale) = sampled_layout(read.layout.as_ref(), "image", 2.0);
        assert_eq!((sampled["xPct"].as_f64(), scale), (Some(20.0), 1.5));
        let command = edit_command(&scope, &target, &patch(json!({ "xPct": 25, "yPct": 15 })), Some(read.start + 2.0));
        let (next, _) = run(&scope, &command);
        let layout = layout_of(&next, &target);
        assert_eq!((layout["xPct"].as_f64(), layout["yPct"].as_f64()), (Some(0.0), Some(15.0)));
        assert_js!(layout["animation"]["tracks"]["xPct"], json!([{ "t": 0, "v": 0 }, { "t": 2, "v": 25.0, "easing": "linear" }, { "t": 4, "v": 40 }]));
        assert_js!(layout["animation"]["tracks"]["scale"], json!([{ "t": 0, "v": 1 }, { "t": 4, "v": 2 }]));
        assert_eq!(edit_command(&scope, &target, &patch(json!({ "xPct": 25 })), Some(read.start + 5.0)), json!({ "type": "noop" }));
    }
    let initial = Frame { x: 10.0, y: 20.0, w: 50.0, h: 50.0, rotation: 0.0, aspect_locked: false };
    let resized = resize_canvas_layout(initial, Corner::Se, 20.0, 20.0, Size { w: 100.0, h: 100.0 }, false, false, 2.0);
    assert_eq!((resized.w, resized.h, resized.x, resized.y), (Some(60.0), Some(60.0), Some(15.0), Some(25.0)));
}

#[test]
fn canvas_edits_key_what_is_keyed_keep_the_rest_static_and_undo_in_one_step() {
    let scope = fixture_scope("keyed position");
    let command = edit_command(&scope, &video(3.0), &patch(json!({ "xPct": 30, "yPct": 20 })), Some(11.0));
    let (next, inverse) = run(&scope, &command);
    let layout = layout_of(&next, &video(3.0));
    assert_js!(layout["animation"]["tracks"]["xPct"], json!([{ "t": 0, "v": 0 }, { "t": 3, "v": 30.0, "easing": "linear" }, { "t": 4, "v": 40 }]));
    assert_js!(layout["animation"]["tracks"]["yPct"], json!([{ "t": 0, "v": 10 }, { "t": 3, "v": 20.0, "easing": "linear" }]));
    assert_eq!(run(&next, &inverse).0, scope);
}

#[test]
fn dragging_an_unkeyed_property_on_an_animated_clip_changes_the_static_value_only() {
    let scope = fixture_scope("unkeyed property on an animated clip");
    let command = edit_command(&scope, &video(4.0), &patch(json!({ "xPct": 25 })), Some(1.0));
    assert_eq!(command["type"], "clip.replace");
    let layout = layout_of(&run(&scope, &command).0, &video(4.0));
    assert_eq!(layout["xPct"].as_f64(), Some(25.0));
    assert!(layout["animation"]["tracks"].get("xPct").is_none());
    assert_eq!(layout["animation"]["tracks"]["opacity"].as_array().map(Vec::len), Some(2));
}

#[test]
fn a_proportional_resize_of_a_scale_keyed_text_keys_scale_and_keeps_its_size_and_centre() {
    let scope = fixture_scope("proportional resize with keyed scale");
    let command = edit_command(&scope, &text(5.0), &patch(json!({ "xPct": 10, "yPct": 10, "widthPct": 60, "heightPct": 30 })), Some(2.0));
    let layout = layout_of(&run(&scope, &command).0, &text(5.0));
    assert_js!(layout["animation"]["tracks"]["scale"], json!([{ "t": 0, "v": 1 }, { "t": 2, "v": 1.5, "easing": "linear" }, { "t": 4, "v": 1 }]));
    assert_eq!((layout["widthPct"].as_f64(), layout["heightPct"].as_f64()), (Some(40.0), Some(20.0)));
    let n = |k: &str| layout[k].as_f64().expect("number");
    assert!(close(n("xPct") + n("widthPct") / 2.0, 40.0) && close(n("yPct") + n("heightPct") / 2.0, 25.0));
}

#[test]
fn a_locked_track_refuses_canvas_edits() {
    let scope = with_flags(&fixture_scope("keyed position"), json!({ "0": { "locked": true } }));
    assert_eq!(edit_command(&scope, &video(3.0), &patch(json!({ "xPct": 30 })), Some(9.0)), json!({ "type": "noop" }));
    assert_eq!(edit_command(&scope, &video(3.0), &patch(json!({ "yPct": 30 })), None), json!({ "type": "noop" }));
}

// ── clip-mask-canvas.test.ts ──

fn mask() -> Value {
    json!({ "shape": "ellipse", "xPct": 20, "yPct": 30, "widthPct": 40, "heightPct": 50, "rotationDeg": 30, "featherPct": 12, "inverted": true })
}

#[test]
fn compositing_writes_one_scene_source_and_reset_preserves_siblings_and_refuses_locks() {
    let scope = fixture_scope("mask on a scene visual");
    let b = Target { visual_id: Some("b".into()), ..Target::new(Source::Scene, 1.0) };
    let a = Target { visual_id: Some("a".into()), ..b.clone() };
    let set = json!({ "mask": mask(), "color": { "brightness": 0.5, "contrast": 1.2, "saturation": 1.5 }, "blendMode": "screen" });
    let (edited, _) = run(&scope, &edit_command(&scope, &b, &patch(set.clone()), None));
    let layout = layout_of(&edited, &b);
    for key in ["mask", "color", "blendMode"] {
        assert_js!(layout[key], set[key], key);
    }
    assert!(layout_of(&edited, &a).get("mask").is_none());
    let reset = patch(json!({ "mask": null, "color": { "brightness": 1, "contrast": 1, "saturation": 1 }, "blendMode": "normal" }));
    let (cleared, _) = run(&edited, &edit_command(&edited, &b, &reset, None));
    assert_eq!(layout_of(&cleared, &b)["mask"], Value::Null);
    let mut invalid = mask();
    invalid["widthPct"] = json!(99);
    assert_eq!(edit_command(&edited, &b, &patch(json!({ "mask": invalid })), None), json!({ "type": "noop" }));
    let locked = with_flags(&edited, json!({ "-1": { "locked": true } }));
    assert_eq!(edit_command(&locked, &b, &LayoutPatch { set: Map::new(), unset: vec!["mask".into()] }, None), json!({ "type": "noop" }));
}

#[test]
fn removing_an_inherited_scene_mask_stays_removed() {
    let clip = json!({ "id": "scene:1", "type": "image", "startSec": 0, "durationSec": 4, "track": 0, "markerId": 1, "scene": { "id": 1, "name": "Scene", "img": true, "src": "a.png", "dur": 4,
        "layout": { "xPct": 0, "yPct": 0, "widthPct": 100, "fit": "cover", "mask": mask() },
        "visualClips": [{ "id": "a", "kind": "image", "label": "Image", "url": "a.png", "startSec": 0, "durationSec": 4 }], "start": 0, "track": 0 } });
    let scope =
        admit_scope(&json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": 2, "markers": [], "clips": [clip] } }).to_string())
            .expect("admits");
    let target = Target { visual_id: Some("a".into()), ..Target::new(Source::Scene, 1.0) };
    let (edited, _) = run(&scope, &edit_command(&scope, &target, &patch(json!({ "mask": null })), None));
    assert_eq!(layout_of(&edited, &target)["mask"], Value::Null);
    // Normalizing keeps the explicit null, so the scene's mask stays overridden.
    assert_eq!(normalize_layout(Some(&layout_of(&edited, &target)), "scene")["mask"], Value::Null);
}
