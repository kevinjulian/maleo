use maleo_editor_core::{admit_command, admit_scope, execute_json};
use serde_json::{Value, json};

fn scope() -> Value {
    json!({"mediaAssets":[], "slides":[], "posts":[], "doc":{
        "schemaVersion":2,"markers":[],
        "captionSet":{"initialized":true,"language":"auto","revision":0,"deletedRanges":[],"appliedRunIds":[]},
        "clips":[
            {"id":"video:1","type":"video","startSec":0,"durationSec":5,"track":0},
            {"id":"caption:1","type":"caption","startSec":1,"durationSec":2,"track":1,"caption":{
                "text":"Hello\nworld!", "words":[{"text":"Hello","startSec":0,"endSec":0.8},{"text":"world!","startSec":1,"endSec":2}],
                "provenance":{"origin":"recognized","wordTimingOrigin":"recognized","engine":"whisper","model":"base","runId":"run-1"},
                "sources":[{"clipId":"video:1","mediaId":"media-1","mediaRevision":"r1","sourceStartSec":1,"sourceEndSec":3}],
                "protection":{"text":false,"timing":false,"segmentation":false,"style":false},
                "revision":0,"groupId":"group-1","status":"current","style":{"fontSize":48,"motion":"Pop"}
            }}
        ]
    }})
}

#[test]
fn caption_scope_and_replacement_round_trip_exactly() {
    let input = scope();
    let admitted = admit_scope(&input.to_string()).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&maleo_editor_core::json::to_js_string(&admitted).unwrap()).unwrap(), input);
    let output: Value = serde_json::from_str(&execute_json(&input.to_string(), r#"{"type":"noop"}"#).unwrap()).unwrap();
    assert_eq!(output["scope"], input);
    assert!(admit_command(&json!({"type":"scope.replace","scope":input}).to_string()).is_ok());
}

#[test]
fn invalid_caption_payloads_are_refused_at_both_scope_boundaries() {
    let cases = [
        ("/doc/clips/1/durationSec", json!(0)),
        ("/doc/clips/1/startSec", json!(-1)),
        ("/doc/clips/1/track", json!(0.5)),
        ("/doc/clips/1/caption/text", json!("")),
        ("/doc/clips/1/caption/words/1/startSec", json!(0.4)),
        ("/doc/clips/1/caption/words/1/endSec", json!(2.1)),
        ("/doc/clips/1/caption/words/1/text", json!("wrong")),
        ("/doc/clips/1/caption/sources/0/sourceStartSec", json!(-1)),
        ("/doc/clips/1/caption/sources/0/sourceEndSec", json!(1)),
        ("/doc/clips/1/caption/sources/0/clipId", json!("missing")),
        ("/doc/clips/1/caption/sources/0/mediaRevision", json!("")),
        ("/doc/clips/1/caption/provenance/model", json!("")),
        ("/doc/clips/1/caption/provenance/origin", json!("confident")),
        ("/doc/clips/1/caption/style/fontSize", json!(-1)),
        ("/doc/clips/1/caption/style/motion", json!("Unknown")),
        ("/doc/clips/1/caption/revision", json!(1.5)),
        ("/doc/captionSet/initialized", json!(false)),
        ("/doc/captionSet", Value::Null),
    ];
    for (path, value) in cases {
        let mut input = scope();
        *input.pointer_mut(path).unwrap() = value;
        assert!(admit_scope(&input.to_string()).is_err(), "accepted {path}");
        assert!(admit_command(&json!({"type":"scope.replace","scope":input}).to_string()).is_err(), "replacement accepted {path}");
    }
    assert!(admit_scope(&scope().to_string().replace("0.8", "1e400")).is_err());
}

#[test]
fn invalid_command_result_cannot_write_a_caption_payload() {
    let command = json!({"type":"clip.update","id":"caption:1","patch":{"durationSec":0.1}});
    assert!(execute_json(&scope().to_string(), &command.to_string()).is_err());
}

#[test]
fn standalone_empty_and_stale_sets_retain_their_meaning() {
    let mut input = scope();
    input["doc"]["clips"][1]["caption"]["sources"] = json!([]);
    assert!(admit_scope(&input.to_string()).is_ok());
    input["doc"]["clips"] = json!([]);
    assert!(admit_scope(&input.to_string()).is_ok());
    let mut input = scope();
    input["doc"]["clips"][1]["caption"]["status"] = json!("needs-refresh");
    input["doc"]["clips"][0]["id"] = json!("replacement");
    assert!(admit_scope(&input.to_string()).is_ok());
}

#[test]
fn bindings_validate_visual_instances_and_source_kinds() {
    let mut input = scope();
    input["doc"]["clips"][0]["type"] = json!("text");
    assert!(admit_scope(&input.to_string()).is_err());
    input["doc"]["clips"][0]["type"] = json!("video");
    input["doc"]["clips"][1]["caption"]["sources"][0]["visualId"] = json!("visual-1");
    assert!(admit_scope(&input.to_string()).is_err());
    input["doc"]["clips"][0]["scene"] = json!({"visualClips":[{"id":"visual-1","kind":"video"}]});
    assert!(admit_scope(&input.to_string()).is_ok());
    input["doc"]["clips"][0]["type"] = json!("image");
    assert!(admit_scope(&input.to_string()).is_ok());
}

#[test]
fn protected_deletions_validate_without_requiring_deleted_sources() {
    let mut input = scope();
    input["doc"]["captionSet"]["deletedRanges"] = json!([{
        "id":"deleted-1","groupId":"group-1","startSec":1,"endSec":3,
        "sources":[{"clipId":"removed","mediaId":"media-1","mediaRevision":"r1","sourceStartSec":1,"sourceEndSec":3}]
    }]);
    assert!(admit_scope(&input.to_string()).is_ok());
    input["doc"]["captionSet"]["deletedRanges"][0]["endSec"] = json!(1);
    assert!(admit_scope(&input.to_string()).is_err());
}

#[test]
fn word_text_uses_javascript_whitespace_rules() {
    let mut input = scope();
    input["doc"]["clips"][1]["caption"]["text"] = json!("Hello\u{feff}world!");
    assert!(admit_scope(&input.to_string()).is_ok());
    input["doc"]["clips"][1]["caption"]["text"] = json!("Hello\u{85}world!");
    assert!(admit_scope(&input.to_string()).is_err());
}

#[test]
fn caption_edits_are_atomic_locked_validated_and_exactly_undoable() {
    for edit in [
        json!({"action":"update","id":"caption:1","text":"Corrected words"}),
        json!({"action":"timing","id":"caption:1","startSec":2,"durationSec":3}),
        json!({"action":"split","id":"caption:1","at":2,"newId":"caption:2"}),
        json!({"action":"delete","ids":["caption:1"]}),
        json!({"action":"style","ids":["caption:1"],"style":{"fontSize":48}}),
        json!({"action":"unlink","ids":["caption:1"]}),
    ] {
        let before = source_scope();
        let command = json!({"type":"caption.edit","edit":edit});
        let output: Value = serde_json::from_str(&execute_json(&before.to_string(), &command.to_string()).unwrap()).unwrap();
        let restored: Value = serde_json::from_str(&execute_json(&output["scope"].to_string(), &output["inverse"].to_string()).unwrap()).unwrap();
        assert_eq!(restored["scope"], before);
        let mut locked = before.clone();
        locked["doc"]["trackFlags"] = json!({"1":{"locked":true}});
        assert!(execute_json(&locked.to_string(), &command.to_string()).is_err());
    }
    for edit in [
        json!({"action":"update","id":"caption:1","text":" "}),
        json!({"action":"timing","id":"caption:1","startSec":-1,"durationSec":2}),
        json!({"action":"split","id":"caption:1","at":2,"newId":"video:1"}),
        json!({"action":"style","ids":["caption:1"],"style":{"fontSize":0}}),
        json!({"action":"delete","ids":["caption:1","missing"]}),
        json!({"action":"delete","ids":["caption:1","caption:1"]}),
        json!({"action":"delete","ids":["caption:1"],"surprise":true}),
    ] {
        assert!(execute_json(&scope().to_string(), &json!({"type":"caption.edit","edit":edit}).to_string()).is_err());
    }
}

#[test]
fn styling_disjoint_cues_keeps_document_order_and_untouched_identity() {
    let mut before = scope();
    let mut second = before["doc"]["clips"][1].clone();
    second["id"] = json!("caption:2");
    before["doc"]["clips"].as_array_mut().unwrap().insert(0, second);
    let command = json!({"type":"caption.edit","edit":{"action":"style","ids":["caption:1","caption:2"],"style":{"fill":"red"}}});
    let output: Value = serde_json::from_str(&execute_json(&before.to_string(), &command.to_string()).unwrap()).unwrap();
    assert_eq!(output["scope"]["doc"]["clips"][0]["id"], "caption:2");
    assert_eq!(output["scope"]["doc"]["clips"][1], before["doc"]["clips"][1]);
    assert_eq!(output["scope"]["doc"]["clips"][2]["id"], "caption:1");
}

#[test]
fn result_application_is_fenced_idempotent_and_no_speech_preserves_state() {
    let before = source_scope();
    let mut candidate = before["doc"]["clips"][1].clone();
    candidate["id"] = json!("caption:result");
    let command = json!({"type":"caption.edit","edit":{
        "action":"apply-result","ids":["caption:1"],"candidates":[candidate],"runId":"job-1","language":"en","replaceEdited":false,
        "startSec":0,"endSec":5,"sources":before["doc"]["clips"][1]["caption"]["sources"],
        "snapshot":{"sourceClips":[before["doc"]["clips"][0]],"cues":[before["doc"]["clips"][1]],"deletedRanges":[],"language":"auto"}
    }});
    let result: Value = serde_json::from_str(&execute_json(&before.to_string(), &command.to_string()).unwrap()).unwrap();
    assert_eq!(result["scope"]["doc"]["captionSet"]["appliedRunIds"], json!(["job-1"]));
    let duplicate: Value = serde_json::from_str(&execute_json(&result["scope"].to_string(), &command.to_string()).unwrap()).unwrap();
    assert_eq!(duplicate["scope"], result["scope"]);
    assert_eq!(duplicate["inverse"], json!({"type":"noop"}));
    let mut empty = command.clone();
    empty["edit"]["candidates"] = json!([]);
    let no_speech: Value = serde_json::from_str(&execute_json(&before.to_string(), &empty.to_string()).unwrap()).unwrap();
    assert_eq!(no_speech["scope"], before);
    let mut changed = before.clone();
    changed["doc"]["clips"][1]["caption"]["revision"] = json!(1);
    assert!(execute_json(&changed.to_string(), &command.to_string()).is_err());
    let mut protected = before.clone();
    protected["doc"]["clips"][1]["caption"]["protection"]["text"] = json!(true);
    assert!(execute_json(&protected.to_string(), &command.to_string()).is_err());
    let mut preserve = command.clone();
    preserve["edit"]["snapshot"]["cues"][0] = protected["doc"]["clips"][1].clone();
    let result = source_edit(&protected, preserve.clone());
    assert_eq!(result["doc"]["clips"][1], protected["doc"]["clips"][1]);
    let mut replace = preserve;
    replace["edit"]["replaceEdited"] = json!(true);
    assert!(execute_json(&protected.to_string(), &replace.to_string()).is_ok());
}

fn source_scope() -> Value {
    let mut value = scope();
    value["doc"]["clips"][0]["video"] =
        json!({"id":1,"kind":"video","url":"/api/media/owned","mediaAssetId":"media-1","start":0,"dur":5,"mediaStartSec":0,"volume":1});
    value
}

fn source_edit(before: &Value, command: Value) -> Value {
    let output: Value = serde_json::from_str(&execute_json(&before.to_string(), &command.to_string()).unwrap()).unwrap();
    let undo: Value = serde_json::from_str(&execute_json(&output["scope"].to_string(), &output["inverse"].to_string()).unwrap()).unwrap();
    assert_eq!(undo["scope"], *before, "source/cue undo mismatch: {command}");
    output["scope"].clone()
}

#[test]
fn source_move_trim_rate_delete_and_duplicate_are_one_undo_step() {
    let before = source_scope();
    let moved = source_edit(&before, json!({"type":"clip.move","id":"video:1","patch":{"startSec":2}}));
    assert_eq!(moved["doc"]["clips"][1]["startSec"], 3);
    assert_eq!(moved["doc"]["clips"][1]["caption"]["text"], "Hello\nworld!");
    let trimmed = source_edit(&before, json!({"type":"clip.trim-before","id":"video:1","at":2}));
    assert_eq!(trimmed["doc"]["clips"][1]["startSec"], 2);
    assert_eq!(trimmed["doc"]["clips"][1]["caption"]["text"], "world!");
    let mut retimed = before["doc"]["clips"][0].clone();
    retimed["durationSec"] = json!(2.5);
    retimed["video"]["dur"] = json!(2.5);
    retimed["video"]["layout"] = json!({"playbackRate":2});
    let result = source_edit(&before, json!({"type":"clip.replace","id":"video:1","clip":retimed}));
    assert_eq!(result["doc"]["clips"][1]["startSec"], 0.5);
    assert_eq!(result["doc"]["clips"][1]["durationSec"], 1);
    assert_eq!(result["doc"]["clips"][1]["caption"]["words"][0]["endSec"], 0.4);
    let deleted = source_edit(&before, json!({"type":"clip.remove","id":"video:1"}));
    assert_eq!(deleted["doc"]["clips"], json!([]));
    let mut copy = before["doc"]["clips"][0].clone();
    copy["id"] = json!("video:copy");
    copy["startSec"] = json!(6);
    copy["video"]["start"] = json!(6);
    let duplicated = source_edit(&before, json!({"type":"clip.insert","clip":copy}));
    let cues: Vec<&Value> = duplicated["doc"]["clips"].as_array().unwrap().iter().filter(|clip| clip["type"] == "caption").collect();
    assert_eq!(cues.len(), 2);
    assert_eq!(cues[1]["id"], "caption:1:source:video:copy");
    assert_eq!(cues[1]["startSec"], 7);
    assert_eq!(cues[1]["caption"]["sources"][0]["clipId"], "video:copy");
}

#[test]
fn mixed_source_ambiguity_audibility_and_locks_have_explicit_outcomes() {
    let mut before = source_scope();
    let mut second = before["doc"]["clips"][0].clone();
    second["id"] = json!("video:2");
    before["doc"]["clips"].as_array_mut().unwrap().push(second);
    let mut binding = before["doc"]["clips"][1]["caption"]["sources"][0].clone();
    binding["clipId"] = json!("video:2");
    before["doc"]["clips"][1]["caption"]["sources"].as_array_mut().unwrap().push(binding);
    let moved = source_edit(&before, json!({"type":"clip.move","id":"video:1","patch":{"startSec":2}}));
    assert_eq!(moved["doc"]["clips"][1]["caption"]["status"], "needs-refresh");
    let uniform = source_edit(
        &before,
        json!({"type":"batch","commands":[{"type":"clip.move","id":"video:1","patch":{"startSec":2}},{"type":"clip.move","id":"video:2","patch":{"startSec":2}}]}),
    );
    assert_eq!(uniform["doc"]["clips"][1]["startSec"], 3);
    assert_eq!(uniform["doc"]["clips"][1]["caption"]["status"], "current");
    let muted = source_edit(&before, json!({"type":"doc.setTrackFlags","trackFlags":{"0":{"muted":true}}}));
    assert_eq!(muted["doc"]["clips"][1]["caption"]["status"], "needs-refresh");
    before["doc"]["trackFlags"] = json!({"1":{"locked":true}});
    assert!(execute_json(&before.to_string(), r#"{"type":"clip.move","id":"video:1","patch":{"startSec":2}}"#).is_err());
}

#[test]
fn splitting_source_partitions_crossing_word_once_and_rebinds_original_intervals() {
    let before = source_scope();
    let mut right = before["doc"]["clips"][0].clone();
    right["id"] = json!("video:right");
    right["startSec"] = json!(2.4);
    right["durationSec"] = json!(2.6);
    right["video"]["start"] = json!(2.4);
    right["video"]["dur"] = json!(2.6);
    right["video"]["mediaStartSec"] = json!(2.4);
    let command = json!({"type":"batch","commands":[{"type":"clip.trim-after","id":"video:1","at":2.4},{"type":"clip.insert","clip":right}]});
    let after = source_edit(&before, command.clone());
    let cues: Vec<&Value> = after["doc"]["clips"].as_array().unwrap().iter().filter(|clip| clip["type"] == "caption").collect();
    assert_eq!(cues.len(), 2, "{after}");
    assert_eq!(cues[0]["caption"]["text"], "Hello");
    assert_eq!(cues[1]["caption"]["text"], "world!");
    assert_eq!(cues[1]["caption"]["sources"][0]["clipId"], "video:right");
    assert_eq!(cues[1]["caption"]["sources"][0]["sourceStartSec"], 2.4);
    let mut corrected = before.clone();
    corrected["doc"]["clips"][1]["caption"]["protection"]["text"] = json!(true);
    let ambiguous = source_edit(&corrected, command);
    let cues: Vec<&Value> = ambiguous["doc"]["clips"].as_array().unwrap().iter().filter(|clip| clip["type"] == "caption").collect();
    assert_eq!(cues.len(), 1);
    assert_eq!(cues[0]["caption"]["text"], "Hello\nworld!");
    assert_eq!(cues[0]["caption"]["status"], "needs-refresh");
}

#[test]
fn scene_local_video_mapping_and_standalone_independence() {
    let mut before = source_scope();
    before["doc"]["clips"][0].as_object_mut().unwrap().remove("video");
    before["doc"]["clips"][0]["durationSec"] = json!(8);
    before["doc"]["clips"][0]["scene"] = json!({"id":1,"dur":8,"visualClips":[{"id":"vis-1","kind":"video","url":"/api/media/owned","mediaAssetId":"media-1","startSec":2,"durationSec":5,"mediaStartSec":0}]});
    before["doc"]["clips"][1]["startSec"] = json!(3);
    before["doc"]["clips"][1]["caption"]["sources"][0]["visualId"] = json!("vis-1");
    let moved = source_edit(&before, json!({"type":"clip.move","id":"video:1","patch":{"startSec":2}}));
    assert_eq!(moved["doc"]["clips"][1]["startSec"], 5);
    let muted = source_edit(&before, json!({"type":"doc.setTrackFlags","trackFlags":{"-1":{"muted":true}}}));
    assert_eq!(muted["doc"]["clips"][1]["caption"]["status"], "needs-refresh");
    before["doc"]["clips"][1]["caption"]["sources"] = json!([]);
    let unchanged = source_edit(&before, json!({"type":"clip.move","id":"video:1","patch":{"startSec":2}}));
    assert_eq!(unchanged["doc"]["clips"][1], before["doc"]["clips"][1]);
}

#[test]
fn replacement_reverse_unlink_and_source_locks_keep_authored_data_safe() {
    let before = source_scope();
    for patch in [json!({"url":"/api/media/replacement"}), json!({"layout":{"reverse":true}}), json!({"volume":0.5})] {
        let mut replacement = before["doc"]["clips"][0].clone();
        replacement["video"].as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
        let after = source_edit(&before, json!({"type":"clip.replace","id":"video:1","clip":replacement}));
        assert_eq!(after["doc"]["clips"][1]["caption"]["status"], "needs-refresh");
        assert_eq!(after["doc"]["clips"][1]["caption"]["text"], before["doc"]["clips"][1]["caption"]["text"]);
        let unlinked = source_edit(&after, json!({"type":"caption.edit","edit":{"action":"unlink","ids":["caption:1"]}}));
        assert_eq!(unlinked["doc"]["clips"][1]["caption"]["sources"], json!([]));
        assert_eq!(unlinked["doc"]["clips"][1]["caption"]["status"], "current");
    }
    let mut locked = before.clone();
    locked["doc"]["trackFlags"] = json!({"0":{"locked":true}});
    assert!(execute_json(&locked.to_string(), r#"{"type":"clip.move","id":"video:1","patch":{"startSec":2}}"#).is_err());
    let mut outside = before.clone();
    outside["doc"]["clips"][1]["caption"]["protection"]["timing"] = json!(true);
    assert!(execute_json(&outside.to_string(), r#"{"type":"caption.edit","edit":{"action":"timing","id":"caption:1","startSec":4,"durationSec":2}}"#).is_err());
}

#[test]
fn deleted_caption_protection_follows_moves_splits_and_duplicate_instances() {
    let before = source_scope();
    let deleted = source_edit(&before, json!({"type":"caption.edit","edit":{"action":"delete","ids":["caption:1"]}}));
    let moved = source_edit(&deleted, json!({"type":"clip.move","id":"video:1","patch":{"startSec":2}}));
    assert_eq!(moved["doc"]["captionSet"]["deletedRanges"][0]["startSec"], 3);
    let mut right = deleted["doc"]["clips"][0].clone();
    right["id"] = json!("video:right");
    right["startSec"] = json!(2);
    right["durationSec"] = json!(3);
    right["video"]["start"] = json!(2);
    right["video"]["dur"] = json!(3);
    right["video"]["mediaStartSec"] = json!(2);
    let split =
        source_edit(&deleted, json!({"type":"batch","commands":[{"type":"clip.trim-after","id":"video:1","at":2},{"type":"clip.insert","clip":right}]}));
    let ranges = split["doc"]["captionSet"]["deletedRanges"].as_array().unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[1]["sources"][0]["clipId"], "video:right");
    assert_eq!(ranges[1]["sources"][0]["sourceStartSec"], 2);
    assert_eq!(ranges[1]["sources"][0]["sourceEndSec"], 3);
    let mut copy = deleted["doc"]["clips"][0].clone();
    copy["id"] = json!("video:copy");
    copy["startSec"] = json!(6);
    copy["video"]["start"] = json!(6);
    let duplicate = source_edit(&deleted, json!({"type":"clip.insert","clip":copy}));
    let ranges = duplicate["doc"]["captionSet"]["deletedRanges"].as_array().unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[1]["startSec"], 7);
    assert_eq!(ranges[1]["endSec"], 9);
    assert_eq!(ranges[1]["sources"][0]["clipId"], "video:copy");
}
