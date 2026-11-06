//! The `cross-platform-editor` scenarios added by `p1-envelope-inspector`, each
//! through `ops::apply_json`, the one call every controller binds.

use maleo_app_core::ops::apply_json;
use maleo_editor_core::{EditScope, admit_scope};
use serde_json::{Value, json};

fn scope(locked: bool) -> EditScope {
    let mut doc = json!({
        "schemaVersion": 2,
        "markers": [],
        "clips": [{
            "id": "video:1", "type": "video", "startSec": 0, "durationSec": 4, "track": 1,
            "video": { "id": 1, "kind": "video", "url": "/api/media/a", "start": 0, "dur": 4,
                "layout": { "xPct": 0, "yPct": 0, "widthPct": 100, "fit": "contain",
                    "animation": { "tracks": {
                        "xPct": [{ "t": 1, "v": 10 }, { "t": 3, "v": 30 }],
                        "yPct": [{ "t": 1, "v": 5 }, { "t": 3, "v": 15 }]
                    } } } }
        }]
    });
    if locked {
        doc["trackFlags"] = json!({ "1": { "locked": true } });
    }
    admit_scope(&json!({ "doc": doc, "mediaAssets": [], "slides": [], "posts": [] }).to_string()).expect("admits")
}

fn call(scope: Option<&EditScope>, input: Value) -> Value {
    serde_json::from_str(&apply_json(scope, &input.to_string()).expect("op runs")).expect("parses")
}

const TARGET: &str = r#"{"source":"video","id":1}"#;

fn target() -> Value {
    serde_json::from_str(TARGET).expect("target")
}

#[test]
fn an_inspector_key_edit_crosses_clients() {
    let scope = scope(false);
    // The playhead sits 0.05 s after the keys at 1 s; X changes on the keyed Position row.
    let input = json!({ "op": "anim.row.set", "target": target(), "properties": ["xPct", "yPct"], "absolute": 1.05, "fps": 100, "values": { "xPct": 12 } });
    let first = call(Some(&scope), input.clone());
    let second = call(Some(&scope), input);
    assert_eq!(first, second, "two controllers make the same commands");
    let commands = first["command"]["commands"].as_array().expect("one batch for the row");
    let keys = |property: &str| commands.iter().find(|c| c["property"] == property).expect("track command")["keys"].clone();
    assert_eq!(first["command"]["type"], "batch");
    assert_eq!(keys("xPct"), json!([{ "t": 1, "v": 12 }, { "t": 3, "v": 30 }]), "X updates its key, adds none");
    assert_eq!(keys("yPct").as_array().map(Vec::len), Some(2), "Y updates its key, adds none");
    assert_eq!(keys("yPct")[0]["t"], json!(1));
}

#[test]
fn a_key_edit_on_a_locked_clip_is_refused() {
    let scope = scope(true);
    let refusal = call(Some(&scope), json!({ "op": "anim.key.edit", "target": target(), "property": "xPct", "time": 1 }));
    assert_eq!(refusal, json!({ "error": "Selected clip is on a locked track" }));
    let message = call(Some(&scope), json!({ "op": "keys.error", "id": "video:1", "property": "xPct", "keys": [{ "t": 1, "v": 0 }] }));
    assert_eq!(message, json!("Selected clip is on a locked track"), "one message for every controller");
}

#[test]
fn inspector_groups_cross_clients() {
    let input = json!({ "op": "groups", "kind": "broll", "options": { "videoHasAudio": true } });
    let groups = call(None, input.clone());
    assert_eq!(groups, call(None, input));
    assert_eq!(groups, json!(["content", "transform", "animation", "blending", "audio", "timing", "masks", "adjust", "motion"]));
}

#[test]
fn a_remembered_group_that_does_not_apply_falls_back_to_the_first() {
    let text = call(None, json!({ "op": "groups", "kind": "text" }));
    assert_eq!(call(None, json!({ "op": "groups.active", "groups": text, "remembered": "masks" })), json!("content"));
}

#[test]
fn an_out_of_range_layout_reads_as_its_default_without_writing() {
    let layout = json!({ "opacity": 1.4 });
    let read = call(None, json!({ "op": "layout.normalize", "kind": "video", "layout": layout }));
    assert_eq!(read["opacity"], json!(1));
    assert_eq!(read["widthPct"], json!(100), "the default width for a video clip");
    assert_eq!(layout, json!({ "opacity": 1.4 }), "the stored layout is unchanged");
}
