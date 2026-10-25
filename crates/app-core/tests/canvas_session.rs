//! The `canvas-editing` scenarios through one canvas session: input events in,
//! the overlay, selection actions, previews and commits out.

use maleo_app_core::canvas::edit::{LayoutPatch, edit_command, resolve};
use maleo_app_core::canvas::session::Session;
use maleo_app_core::canvas::{Source, Target};
use maleo_editor_core::command::admit_command_value;
use maleo_editor_core::schema::EditScope;
use maleo_editor_core::{admit_scope, execute};
use serde_json::{Map, Value, json};

/// The fixtures' overlay document: `video:2` (image, track 1) at 10, 20, 40 × 30
/// from 0 to 4 s; `video:3` keyed on x from 8 to 12 s; text and a scene under them.
fn scope() -> EditScope {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/canvas.json")).expect("fixtures");
    let case = fixtures["edits"].as_array().expect("edits").iter().find(|c| c["name"] == "static position").expect("case").clone();
    admit_scope(&case["scope"].to_string()).expect("admits")
}

fn run(scope: &EditScope, command: &Value) -> (EditScope, Value) {
    let executed = execute(scope, &admit_command_value(command.clone()).expect("admits")).expect("executes");
    (executed.scope, serde_json::to_value(&executed.inverse).expect("inverse"))
}

fn edited(scope: &EditScope, target: &Target, patch: Value) -> EditScope {
    run(scope, &edit_command(scope, target, &LayoutPatch::set(patch.as_object().cloned().unwrap_or_default()), None)).0
}

fn layout(scope: &EditScope, target: &Target) -> Map<String, Value> {
    resolve(scope, target).and_then(|r| r.layout).expect("layout")
}

fn n(layout: &Map<String, Value>, key: &str) -> f64 {
    layout[key].as_f64().unwrap_or_else(|| panic!("{key} in {layout:?}"))
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-8
}

fn video(id: f64) -> Target {
    Target::new(Source::Video, id)
}

/// A 800 × 450 canvas filling its area, one pixel 0.125 by 0.222 percent.
struct Canvas {
    session: Session,
    targets: Vec<Target>,
    time: f64,
    extra: Value,
}

impl Canvas {
    fn new(targets: Vec<Target>, time: f64) -> Self {
        let mut session = Session::default();
        session.set_view(&json!({ "area": { "x": 0, "y": 0, "width": 800, "height": 450 }, "aspect": 800.0 / 450.0 })).expect("view");
        Self { session, targets, time, extra: json!({}) }
    }

    fn send(&mut self, scope: &EditScope, kind: &str, x: f64, y: f64, extra: Value) -> Value {
        let mut event = json!({ "type": kind, "x": x, "y": y, "time": self.time, "targets": self.targets.iter().map(Target::to_value).collect::<Vec<_>>() });
        for source in [&self.extra, &extra] {
            for (k, v) in source.as_object().into_iter().flatten() {
                event[k] = v.clone();
            }
        }
        self.session.input(scope, &event).expect("an input result")
    }

    /// Down at `(x, y)`, then move to each point, then up; the last move's result and the release's.
    fn drag(&mut self, scope: &EditScope, from: (f64, f64), to: &[(f64, f64)], extra: Value) -> (Value, Value) {
        let down = self.send(scope, "down", from.0, from.1, extra.clone());
        assert_eq!(down["handled"], true, "{down}");
        let mut last = Value::Null;
        for &(x, y) in to {
            last = self.send(scope, "move", x, y, extra.clone());
        }
        let up = self.send(scope, "up", to.last().map_or(from.0, |p| p.0), to.last().map_or(from.1, |p| p.1), extra);
        (last, up)
    }
}

// The centre of video:2 is (30, 35) percent: (240, 157.5) px.
const CENTRE: (f64, f64) = (240.0, 157.5);

#[test]
fn a_drag_snaps_to_the_centre_and_shows_the_guide() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    // 18.5 percent right puts the box centre 1.5 percent left of the canvas centre.
    let (moved, up) = canvas.drag(&s, CENTRE, &[(CENTRE.0 + 148.0, CENTRE.1)], json!({}));
    assert_eq!(moved["overlay"]["guides"]["x"], json!(50.0));
    assert!(close(moved["overlay"]["box"]["xPct"].as_f64().expect("x"), 30.0));
    let after = run(&s, &up["commit"]).0;
    assert!(close(n(&layout(&after, &video(2.0)), "xPct"), 30.0));
}

#[test]
fn alt_turns_snapping_off() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    let (moved, up) = canvas.drag(&s, CENTRE, &[(CENTRE.0 + 148.0, CENTRE.1)], json!({ "alt": true }));
    assert_eq!(moved["overlay"]["guides"], json!({ "x": null, "y": null }));
    assert!(close(n(&layout(&run(&s, &up["commit"]).0, &video(2.0)), "xPct"), 28.5));
}

#[test]
fn a_drag_previews_forty_moves_and_commits_one_undo_step() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    let path: Vec<(f64, f64)> = (1..=40).map(|i| (CENTRE.0 + f64::from(i) * 2.0, CENTRE.1)).collect();
    let (moved, up) = canvas.drag(&s, CENTRE, &path, json!({ "alt": true }));
    assert_eq!(moved["preview"]["type"], "clip.replace", "a preview while dragging");
    assert_eq!(moved["commit"], Value::Null);
    assert_eq!(up["preview"], Value::Null);
    let (after, inverse) = run(&s, &up["commit"]);
    assert!(close(n(&layout(&after, &video(2.0)), "xPct"), 20.0));
    assert_eq!(run(&after, &inverse).0, s, "one undo restores the prior position");
}

#[test]
fn escape_cancels_a_drag() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    canvas.send(&s, "down", CENTRE.0, CENTRE.1, json!({}));
    canvas.send(&s, "move", CENTRE.0 + 50.0, CENTRE.1, json!({}));
    let escaped = canvas.send(&s, "key", 0.0, 0.0, json!({ "key": "Escape" }));
    assert_eq!((escaped["handled"].clone(), escaped["preview"].clone()), (json!(true), Value::Null));
    assert!(close(escaped["overlay"]["box"]["xPct"].as_f64().expect("x"), 10.0), "the prior position shows");
    let up = canvas.send(&s, "up", CENTRE.0 + 50.0, CENTRE.1, json!({}));
    assert_eq!(up["commit"], Value::Null);
}

#[test]
fn a_release_without_a_change_or_on_a_locked_element_makes_no_command() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    assert_eq!(canvas.drag(&s, CENTRE, &[], json!({})).1["commit"], Value::Null);
    let locked = run(&s, &json!({ "type": "doc.setTrackFlags", "trackFlags": { "1": { "locked": true } } })).0;
    let down = canvas.send(&locked, "down", CENTRE.0, CENTRE.1, json!({}));
    assert_eq!(down["select"], Value::Null, "the locked box keeps the click");
    assert_eq!(down["overlay"]["box"]["handles"], json!([]));
    canvas.send(&locked, "move", CENTRE.0 + 80.0, CENTRE.1, json!({}));
    assert_eq!(canvas.send(&locked, "up", CENTRE.0 + 80.0, CENTRE.1, json!({}))["commit"], Value::Null);
}

#[test]
fn a_keyed_position_is_keyed_at_the_playhead() {
    let s = scope();
    // At 11 s video:3 is at x 30 (keys 0 → 40 over its 4 s), y 10, 50 × 50: centre (440, 157.5).
    let mut canvas = Canvas::new(vec![video(3.0)], 11.0);
    let (_, up) = canvas.drag(&s, (440.0, 157.5), &[(520.0, 157.5)], json!({ "alt": true }));
    let steps = up["commit"]["commands"].as_array().expect("x and y are both keyed");
    assert!(steps.iter().all(|c| c["type"] == "clip.setKeys"));
    let after = run(&s, &up["commit"]).0;
    let l = layout(&after, &video(3.0));
    assert_eq!(n(&l, "xPct"), 0.0, "the static position is unchanged");
    let keys = l["animation"]["tracks"]["xPct"].as_array().expect("keys");
    assert!(keys.iter().any(|k| k["t"] == json!(3.0) && close(k["v"].as_f64().expect("v"), 40.0)), "{keys:?}");
}

#[test]
fn an_aspect_locked_corner_drag_scales_both_sides_alike() {
    let s = edited(&scope(), &video(2.0), json!({ "aspectLocked": true }));
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    // The box spans (80, 90)..(400, 225) px; the se handle's centre is 12 px inside that corner.
    let (_, up) = canvas.drag(&s, (388.0, 213.0), &[(428.0, 223.0)], json!({ "alt": true }));
    let l = layout(&run(&s, &up["commit"]).0, &video(2.0));
    assert!(close(n(&l, "widthPct") / 40.0, n(&l, "heightPct") / 30.0));
    assert!(n(&l, "widthPct") > 40.0);
}

#[test]
fn a_rotate_handle_turns_in_fifteen_degree_steps() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    // The rotate handle sits at the top centre, 12 px down: (240, 102). Swing it to the right of the centre.
    let (_, up) = canvas.drag(&s, (240.0, 102.0), &[(320.0, 160.0)], json!({}));
    let l = layout(&run(&s, &up["commit"]).0, &video(2.0));
    assert_eq!(n(&l, "rotationDeg") % 15.0, 0.0);
    assert_eq!(n(&l, "rotationDeg"), 90.0);
}

#[test]
fn an_arrow_key_on_a_handle_nudges_and_undoes() {
    let s = edited(&scope(), &video(2.0), json!({ "xPct": 20 }));
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    let nudged = canvas.send(&s, "key", 0.0, 0.0, json!({ "key": "ArrowRight", "handle": "move" }));
    let (after, inverse) = run(&s, &nudged["commit"]);
    assert_eq!(n(&layout(&after, &video(2.0)), "xPct"), 21.0);
    assert_eq!(n(&layout(&run(&after, &inverse).0, &video(2.0)), "xPct"), 20.0);
    let ten = canvas.send(&s, "key", 0.0, 0.0, json!({ "key": "ArrowDown", "handle": "move", "shift": true }));
    assert_eq!(n(&layout(&run(&s, &ten["commit"]).0, &video(2.0)), "yPct"), 30.0);
}

#[test]
fn a_click_selects_and_a_shift_click_toggles() {
    let s = scope();
    let mut canvas = Canvas::new(Vec::new(), 1.0);
    // At (240, 157.5) video:2 (track 1) is above video:4 (track 0), and no text box covers it.
    let click = canvas.send(&s, "down", CENTRE.0, CENTRE.1, json!({}));
    assert_eq!(click["select"], json!({ "type": "selectClip", "source": "video", "refId": 2.0 }));
    let shift = canvas.send(&s, "down", 400.0, 340.0, json!({ "shift": true }));
    assert_eq!(shift["select"], json!({ "type": "toggleClip", "source": "text", "refId": 1.0 }));
}

fn text(id: f64) -> Target {
    Target::new(Source::Text, id)
}

#[test]
fn moving_a_group_moves_both_and_undoes_once() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0), text(1.0)], 1.0);
    let (moved, up) = canvas.drag(&s, CENTRE, &[(CENTRE.0 + 80.0, CENTRE.1)], json!({ "alt": true }));
    assert_eq!(moved["overlay"]["box"]["kind"], "group");
    assert_eq!(moved["overlay"]["members"].as_array().map(Vec::len), Some(2));
    assert_eq!(up["commit"]["type"], "batch");
    let (after, inverse) = run(&s, &up["commit"]);
    assert!(close(n(&layout(&after, &video(2.0)), "xPct"), 20.0));
    assert!(close(n(&layout(&after, &text(1.0)), "xPct"), 18.0));
    assert_eq!(run(&after, &inverse).0, s);
}

#[test]
fn rotating_a_group_turns_each_centre_about_the_group_centre() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0), text(1.0)], 1.0);
    // Group box: x 8..92 percent, y 20..86 percent → (64, 90)..(736, 387) px, centre (400, 238.5).
    let (cx, cy) = (400.0, 238.5);
    let handle = (cx, 90.0 + 12.0);
    let (_, up) = canvas.drag(&s, handle, &[(cx + (cy - handle.1), cy)], json!({}));
    let after = run(&s, &up["commit"]).0;
    for (target, before) in [(video(2.0), (240.0, 157.5)), (text(1.0), (400.0, 337.5))] {
        let l = layout(&after, &target);
        assert_eq!(n(&l, "rotationDeg"), 90.0);
        let centre = ((n(&l, "xPct") + n(&l, "widthPct") / 2.0) * 8.0, (n(&l, "yPct") + n(&l, "heightPct") / 2.0) * 4.5);
        let expected = (cx - (before.1 - cy), cy + (before.0 - cx));
        assert!(close(centre.0, expected.0) && close(centre.1, expected.1), "{centre:?} != {expected:?}");
    }
}

#[test]
fn a_locked_member_stops_the_group() {
    let s = run(&scope(), &json!({ "type": "doc.setTrackFlags", "trackFlags": { "1": { "locked": true } } })).0;
    let mut canvas = Canvas::new(vec![video(2.0), text(1.0)], 1.0);
    canvas.send(&s, "down", CENTRE.0, CENTRE.1, json!({}));
    canvas.send(&s, "move", CENTRE.0 + 80.0, CENTRE.1, json!({}));
    assert_eq!(canvas.send(&s, "up", CENTRE.0 + 80.0, CENTRE.1, json!({}))["commit"], Value::Null);
}

#[test]
fn a_group_with_a_keyed_member_on_a_wide_canvas_keys_it_and_replaces_the_other() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0), video(3.0)], 11.0);
    let (_, up) = canvas.drag(&s, (440.0, 157.5), &[(520.0, 157.5)], json!({ "alt": true }));
    let steps: Vec<&str> = up["commit"]["commands"].as_array().expect("a batch").iter().filter_map(|c| c["type"].as_str()).collect();
    assert_eq!(steps, vec!["clip.replace", "clip.setKeys", "clip.setKeys"]);
    let after = run(&s, &up["commit"]).0;
    assert!(close(n(&layout(&after, &video(2.0)), "xPct"), 20.0));
}

#[test]
fn pinch_out_doubles_the_size_about_the_centre_and_undoes() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    canvas.send(&s, "pinch", 0.0, 0.0, json!({ "scale": 1.5, "alt": true }));
    let pinched = canvas.send(&s, "pinch", 0.0, 0.0, json!({ "scale": 2.0, "alt": true }));
    assert_eq!(pinched["preview"]["type"], "clip.replace");
    let up = canvas.send(&s, "up", 0.0, 0.0, json!({}));
    let (after, inverse) = run(&s, &up["commit"]);
    let l = layout(&after, &video(2.0));
    assert!(close(n(&l, "widthPct"), 80.0) && close(n(&l, "heightPct"), 60.0));
    assert!(close(n(&l, "xPct"), -10.0) && close(n(&l, "yPct"), 5.0));
    assert_eq!(run(&after, &inverse).0, s);
}

#[test]
fn a_twist_rotates_with_snapping() {
    let s = scope();
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    canvas.send(&s, "twist", 0.0, 0.0, json!({ "angle": 32 }));
    let up = canvas.send(&s, "up", 0.0, 0.0, json!({}));
    assert_eq!(n(&layout(&run(&s, &up["commit"]).0, &video(2.0)), "rotationDeg"), 30.0);
}

#[test]
fn dragging_the_mask_box_moves_only_the_mask() {
    let mask = json!({ "shape": "rectangle", "xPct": 25, "yPct": 25, "widthPct": 50, "heightPct": 50, "rotationDeg": 0, "featherPct": 0, "inverted": false });
    let s = edited(&scope(), &video(2.0), json!({ "mask": mask }));
    let mut canvas = Canvas::new(vec![video(2.0)], 1.0);
    canvas.extra = json!({ "mask": true });
    let shown = canvas
        .session
        .overlay(
            &s,
            &maleo_app_core::canvas::session::Context::from_value(&json!({ "time": 1, "targets": [video(2.0).to_value()], "mask": true })).expect("context"),
        )
        .expect("overlay");
    assert_eq!(shown["box"]["kind"], "mask");
    // The mask box is the middle half of the element: centre (240, 157.5) px still.
    let (_, up) = canvas.drag(&s, CENTRE, &[(CENTRE.0 + 40.0, CENTRE.1)], json!({ "alt": true }));
    let (after, inverse) = run(&s, &up["commit"]);
    let l = layout(&after, &video(2.0));
    assert_eq!(n(&l, "xPct"), 10.0, "the element stays");
    assert!(close(l["mask"]["xPct"].as_f64().expect("x"), 37.5), "{:?}", l["mask"]);
    assert_eq!(run(&after, &inverse).0, s);
}
