//! The crate against the TS contract: the golden fixtures and the real-project
//! corpus in `packages/shared/src/editor/`.

use std::fs;
use std::path::{Path, PathBuf};

use maleo_editor_core::json::{js_number_string, to_js_string};
use maleo_editor_core::{Clip, EditScope, EditorCommand, EngineError, admit_command, admit_scope, apply_command, execute, execute_json, invert_command};
use serde_json::{Value, json};

/// The whole vocabulary: every type executes.
const EXECUTED: [&str; 31] = maleo_editor_core::command::COMMAND_TYPES;

fn editor_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor")
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .expect("readable dir")
        .map(|entry| entry.expect("entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// JSON equality as JavaScript sees it: object key order is irrelevant and a
/// number is its value, whether written `2` or computed as `2.0`.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(key, value)| y.get(key).is_some_and(|other| same(value, other))),
        _ => a == b,
    }
}

fn as_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::from_str(&to_js_string(value).expect("serializes")).expect("parses")
}

fn corpus() -> Vec<(PathBuf, String)> {
    json_files(&editor_dir().join("corpus/scopes"))
        .into_iter()
        .map(|path| {
            let text = read(&path);
            (path, text)
        })
        .collect()
}

#[test]
fn golden_fixtures_of_executed_types_match_exactly() {
    let mut checked = 0;
    for kind in EXECUTED {
        for path in json_files(&editor_dir().join("fixtures").join(kind)) {
            let fixture: Value = serde_json::from_str(&read(&path)).expect("fixture parses");
            let scope = admit_scope(&fixture["scope"].to_string()).expect("scope admits");
            let command = admit_command(&fixture["command"].to_string()).expect("command admits");
            let after = apply_command(&scope, &command).expect("applies");
            let inverse = invert_command(&scope, &command).expect("inverts");
            let restored = apply_command(&after, &inverse).expect("inverse applies");
            assert!(same(&as_value(&after), &fixture["expectedScope"]), "{}: scope", path.display());
            assert!(same(&as_value(&inverse), &fixture["expectedInverse"]), "{}: inverse", path.display());
            assert!(same(&as_value(&restored), &fixture["expectedRestored"]), "{}: restored", path.display());
            checked += 1;
        }
    }
    assert!(checked >= EXECUTED.len(), "every executed type has a fixture ({checked})");
}

#[test]
fn every_fixture_type_is_executed() {
    for entry in fs::read_dir(editor_dir().join("fixtures")).expect("fixtures dir") {
        let kind = entry.expect("entry").file_name().to_string_lossy().into_owned();
        assert!(EXECUTED.contains(&kind.as_str()), "fixture type {kind} is not in the vocabulary");
    }
}

#[test]
fn corpus_scopes_admit_and_round_trip() {
    let corpus = corpus();
    assert!(!corpus.is_empty(), "the exported corpus is present");
    for (path, text) in &corpus {
        let scope = admit_scope(text).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let original: Value = serde_json::from_str(text).expect("parses");
        assert!(same(&as_value(&scope), &original), "{}: admission lost or changed a value", path.display());
    }
}

/// Every number JavaScript wrote in the fixtures and corpus re-serializes to
/// the same text, so a value the engine does not touch keeps its bytes.
#[test]
fn every_stored_number_keeps_its_text() {
    let mut files: Vec<PathBuf> = corpus().into_iter().map(|(path, _)| path).collect();
    for entry in fs::read_dir(editor_dir().join("fixtures")).expect("fixtures dir") {
        files.extend(json_files(&entry.expect("entry").path()));
    }
    let mut checked = 0;
    for path in files {
        let mut stack = vec![serde_json::from_str::<Value>(&read(&path)).expect("parses")];
        let text = read(&path);
        while let Some(value) = stack.pop() {
            match value {
                Value::Number(number) => {
                    let written = js_number_string(number.as_f64().expect("finite")).expect("finite");
                    assert!(text.contains(&written), "{}: {number} would be written as {written}", path.display());
                    checked += 1;
                }
                Value::Array(items) => stack.extend(items),
                Value::Object(fields) => stack.extend(fields.into_iter().map(|(_, value)| value)),
                _ => {}
            }
        }
    }
    assert!(checked > 1000, "checked {checked} numbers");
}

fn generated_commands(scope: &EditScope) -> Vec<EditorCommand> {
    let mut commands: Vec<EditorCommand> = scope
        .doc
        .clips
        .iter()
        .flat_map(|clip| {
            let middle = clip.start_sec + clip.duration_sec / 2.0;
            let mut patch = serde_json::Map::new();
            patch.insert("startSec".into(), json!(clip.start_sec + 0.5));
            let mut update = serde_json::Map::new();
            update.insert("durationSec".into(), json!(clip.duration_sec + 0.25));
            update.insert("generatedField".into(), json!("added by the edit"));
            let mut copy = Clip::clone(clip);
            copy.id = format!("{}:copy", clip.id);
            vec![
                EditorCommand::ClipMove { id: clip.id.clone(), patch: patch.clone() },
                EditorCommand::ClipTrimBefore { id: clip.id.clone(), at: middle },
                EditorCommand::ClipTrimAfter { id: clip.id.clone(), at: middle },
                EditorCommand::ClipReplace { id: clip.id.clone(), clip: Clip::clone(clip) },
                EditorCommand::ClipUpdate { id: clip.id.clone(), patch: update },
                EditorCommand::ClipRemove { id: clip.id.clone() },
                EditorCommand::ClipSetKeys {
                    id: clip.id.clone(),
                    property: "opacity".into(),
                    keys: vec![json!({ "t": 0, "v": 0 }), json!({ "t": clip.duration_sec / 2.0, "v": 1, "easing": "in" })],
                },
                EditorCommand::ClipSetKeys { id: clip.id.clone(), property: "opacity".into(), keys: vec![] },
                EditorCommand::ClipSetKeys { id: clip.id.clone(), property: "opacity".into(), keys: vec![json!({ "t": 0, "v": 5 })] },
                EditorCommand::ClipSetKeys { id: clip.id.clone(), property: "fill".into(), keys: vec![json!({ "t": 0, "v": "#fff" })] },
                EditorCommand::ClipSetKeys { id: clip.id.clone(), property: "volume".into(), keys: vec![json!({ "t": 0, "v": 0.5 })] },
                EditorCommand::ClipSetKeys { id: clip.id.clone(), property: "scale".into(), keys: vec![json!({ "t": clip.duration_sec * 2.0, "v": 1 })] },
                EditorCommand::ClipResize { id: clip.id.clone(), duration_sec: clip.duration_sec / 2.0, start_sec: None },
                EditorCommand::ClipResize { id: clip.id.clone(), duration_sec: clip.duration_sec * 3.0, start_sec: None },
                EditorCommand::ClipResize { id: clip.id.clone(), duration_sec: clip.duration_sec, start_sec: Some(clip.start_sec - 1.0) },
                EditorCommand::ClipResize {
                    id: clip.id.clone(),
                    duration_sec: clip.duration_sec / 3.0,
                    start_sec: Some(clip.start_sec + clip.duration_sec / 3.0),
                },
                EditorCommand::ClipInsert { clip: copy.clone(), index: Some(1.0) },
                EditorCommand::ClipInsert { clip: copy, index: None },
                EditorCommand::Batch {
                    commands: vec![
                        EditorCommand::ClipMove { id: clip.id.clone(), patch },
                        EditorCommand::ClipTrimAfter { id: clip.id.clone(), at: middle + 0.5 },
                    ],
                    label: Some(json!("generated")),
                },
            ]
        })
        .collect();
    for (index, marker) in scope.doc.markers.iter().enumerate() {
        let Some(id) = marker.get("id").and_then(Value::as_f64) else { continue };
        let mut patch = serde_json::Map::new();
        patch.insert("generatedField".into(), json!(index));
        commands.push(EditorCommand::MarkerUpdate { id, patch });
        commands.push(EditorCommand::MarkerRemove { id });
        commands.push(EditorCommand::MarkerUpsert { marker: marker.clone(), index: None });
    }
    commands.push(EditorCommand::MarkerUpsert { marker: json!({ "id": 987654, "time": 1.5 }), index: Some(0.0) });
    let field = |key: &str| scope.doc.extra.get(key).cloned();
    commands.extend([
        EditorCommand::BookmarkSet { bookmarks: None },
        EditorCommand::BookmarkSet { bookmarks: Some(json!([{ "id": "generated", "atSec": 1 }])) },
        EditorCommand::BookmarkUpsert { bookmark: json!({ "id": "generated", "timeSec": 2, "label": "  Generated  " }) },
        EditorCommand::BookmarkUpsert { bookmark: json!({ "id": "upserted", "timeSec": 3, "label": "New" }) },
        EditorCommand::BookmarkUpsert { bookmark: json!({ "id": "invalid", "timeSec": -1, "label": "x" }) },
        EditorCommand::BookmarkRemove { id: "generated".into() },
        EditorCommand::DocSetCaptions { captions: None },
        EditorCommand::DocSetCaptions { captions: Some(Value::Null) },
        EditorCommand::DocSetCaptions { captions: field("captions") },
        EditorCommand::DocSetProjectReferences { project_references: None },
        EditorCommand::DocSetMaterials { materials: Some(json!({})) },
        EditorCommand::DocSetTrackFlags { track_flags: Some(json!({ "0": { "locked": true } })) },
        EditorCommand::MediaUpdate { media_assets: vec![] },
        EditorCommand::MediaAdmit { asset: json!({ "id": "generated", "url": "/uploads/generated.png", "kind": "image" }) },
        EditorCommand::ScopeReplace { scope: scope.clone(), label: None },
        EditorCommand::Noop,
    ]);
    let first_bookmark = field("bookmarks").and_then(|list| list.as_array().and_then(|items| items.first().cloned()));
    if let Some(id) = first_bookmark.as_ref().and_then(|bookmark| bookmark.get("id")).and_then(Value::as_str) {
        commands.push(EditorCommand::BookmarkRemove { id: id.to_owned() });
    }
    if let Some(asset) = scope.media_assets.first() {
        commands.push(EditorCommand::MediaAdmit { asset: asset.clone() });
    }
    commands
}

#[test]
fn corpus_edits_invert_exactly_and_leave_other_clips_untouched() {
    let (mut executed, mut not_ported) = (0, 0);
    for (path, text) in corpus() {
        let before = admit_scope(&text).expect("admits");
        let snapshot = before.clone();
        for command in generated_commands(&before) {
            let result = match execute(&before, &command) {
                Ok(result) => result,
                Err(EngineError::NotPorted(_)) => {
                    not_ported += 1;
                    continue;
                }
                Err(error) => panic!("{}: {command:?}: {error}", path.display()),
            };
            let restored = apply_command(&result.scope, &result.inverse).expect("inverse applies");
            assert!(same(&as_value(&restored), &as_value(&before)), "{}: {command:?} did not invert", path.display());
            // Save and reload: the edited scope re-admits to the same document, its
            // inverse survives storage as a command, and the stored inverse still
            // undoes the edit against the reloaded scope.
            let saved = to_js_string(&result.scope).expect("saves");
            let reloaded = admit_scope(&saved).unwrap_or_else(|error| panic!("{}: {command:?}: reload refused: {error}", path.display()));
            assert_eq!(to_js_string(&reloaded).expect("re-saves"), saved, "{}: {command:?} changed on reload", path.display());
            let stored_inverse = admit_command(&to_js_string(&result.inverse).expect("inverse saves"))
                .unwrap_or_else(|error| panic!("{}: {command:?}: stored inverse refused: {error}", path.display()));
            let undone = apply_command(&reloaded, &stored_inverse).expect("stored inverse applies");
            assert!(same(&as_value(&undone), &as_value(&before)), "{}: {command:?} stored inverse did not undo after reload", path.display());
            // Every clip the command does not name keeps its bytes, wherever it now sits.
            let target = match &command {
                EditorCommand::ClipMove { id, .. }
                | EditorCommand::ClipUpdate { id, .. }
                | EditorCommand::ClipTrimBefore { id, .. }
                | EditorCommand::ClipTrimAfter { id, .. }
                | EditorCommand::ClipReplace { id, .. }
                | EditorCommand::ClipResize { id, .. }
                | EditorCommand::ClipSetKeys { id, .. }
                | EditorCommand::ClipRemove { id } => Some(id.clone()),
                EditorCommand::Batch { .. } | EditorCommand::ScopeReplace { .. } => None,
                _ => Some(String::new()),
            };
            if let Some(target) = target {
                for new in result.scope.doc.clips.iter().filter(|clip| clip.id != target) {
                    if let Some(old) = before.doc.clips.iter().find(|clip| clip.id == new.id) {
                        assert_eq!(to_js_string(old).expect("old"), to_js_string(new).expect("new"), "{}: untouched clip {} changed", path.display(), old.id);
                    }
                }
            }
            executed += 1;
        }
        assert_eq!(before, snapshot, "{}: executing mutated the input", path.display());
    }
    assert!(executed > 0, "corpus edits executed");
    eprintln!("corpus edits: {executed} executed, {not_ported} refused as not ported");
}

#[test]
fn unsupported_schema_versions_are_refused_before_execution() {
    let scope =
        |version: Value| json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": version, "clips": [], "markers": [] } }).to_string();
    assert_eq!(admit_scope(&scope(json!(3))), Err(EngineError::UnsupportedSchemaVersion("3".into())));
    assert_eq!(admit_scope(&scope(json!("2"))), Err(EngineError::UnsupportedSchemaVersion("\"2\"".into())));
    assert!(admit_scope(&scope(json!(2))).is_ok());
    assert!(matches!(execute_json(&scope(json!(1)), r#"{"type":"noop"}"#), Err(EngineError::UnsupportedSchemaVersion(_))));
}

#[test]
fn unknown_fields_survive_admission_execution_and_serialization() {
    let input = json!({
        "mediaAssets": [], "slides": [], "posts": [], "scopeFuture": { "a": 1 },
        "doc": { "schemaVersion": 2, "markers": [], "docFuture": [1, "x"], "clips": [
            { "id": "text:1", "type": "text", "startSec": 1, "durationSec": 2, "track": 0, "clipFuture": true, "text": { "start": 1, "dur": 2, "payloadFuture": 0.1 } }
        ] }
    });
    let out: Value = serde_json::from_str(&execute_json(&input.to_string(), r#"{"type":"clip.move","id":"text:1","patch":{"startSec":3}}"#).expect("executes"))
        .expect("parses");
    let scope = &out["scope"];
    assert_eq!(scope["scopeFuture"], json!({ "a": 1 }));
    assert_eq!(scope["doc"]["docFuture"], json!([1, "x"]));
    assert_eq!(scope["doc"]["clips"][0]["clipFuture"], json!(true));
    assert_eq!(scope["doc"]["clips"][0]["text"], json!({ "start": 3, "dur": 2, "payloadFuture": 0.1 }), "mirrored timing, other payload fields kept");
}

#[test]
fn source_bounds_hold_on_trim() {
    // A reversed 2x clip whose window would start before the source refuses
    // instead of writing a negative source time.
    let input = json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": 2, "markers": [], "clips": [
        { "id": "video:1", "type": "video", "startSec": 0, "durationSec": 4, "track": 0, "video": { "id": 1, "kind": "video", "start": 0, "dur": 4, "mediaStartSec": 0, "layout": { "playbackRate": 2, "reverse": true } } }
    ] } });
    let scope = admit_scope(&input.to_string()).expect("admits");
    let trimmed = apply_command(&scope, &EditorCommand::ClipTrimBefore { id: "video:1".into(), at: 1.0 }).expect("trims");
    let video = &as_value(&trimmed)["doc"]["clips"][0]["video"];
    assert!(
        same(video, &json!({ "id": 1, "kind": "video", "start": 1, "dur": 3, "mediaStartSec": 0, "layout": { "playbackRate": 2, "reverse": true } })),
        "{video}"
    );
}

#[test]
fn the_engine_depends_on_nothing_that_does_io() {
    let manifest = read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"));
    let dependencies = manifest.split("[dependencies]").nth(1).expect("dependencies table").split("\n[").next().expect("table body");
    let names: Vec<&str> = dependencies.lines().filter_map(|line| line.split_once('=').map(|(name, _)| name.trim())).filter(|name| !name.is_empty()).collect();
    // `ts-rs` is optional and compile-time only (the `typescript` feature derives
    // the TS boundary types); it never runs inside a host.
    assert_eq!(names, ["serde", "serde_json", "ts-rs"], "add a dependency here only after checking it does no IO");
    assert!(dependencies.lines().any(|line| line.starts_with("ts-rs") && line.contains("optional = true")), "ts-rs stays optional");
}

#[test]
fn clips_of_unknown_type_are_refused_at_admission() {
    let scope = |kind: &str| {
        json!({ "mediaAssets": [], "slides": [], "posts": [], "doc": { "schemaVersion": 2, "markers": [], "clips": [
            { "id": "x:1", "type": kind, "startSec": 0, "durationSec": 1, "track": 0 }
        ] } })
        .to_string()
    };
    assert!(admit_scope(&scope("text")).is_ok());
    assert!(matches!(admit_scope(&scope("hologram")), Err(EngineError::InvalidInput(_))));
}

/// The engine source names no host API: no files, network, processes,
/// environment, clocks or threads. A host owns all of those.
#[test]
fn the_engine_source_reaches_no_host_api() {
    const FORBIDDEN: [&str; 6] = ["std::fs", "std::net", "std::process", "std::env", "std::time", "std::thread"];
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for path in files_with_ext(&src, "rs") {
        let text = read(&path);
        for api in FORBIDDEN {
            assert!(!text.contains(api), "{} uses {api}; host IO belongs to the binding or the host", path.display());
        }
    }
}

fn files_with_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .expect("readable dir")
        .map(|entry| entry.expect("entry").path())
        .filter(|path| path.extension().is_some_and(|found| found == ext))
        .collect()
}

#[test]
fn every_command_names_its_own_wire_type() {
    let mut named = std::collections::BTreeSet::new();
    for kind in EXECUTED {
        for path in json_files(&editor_dir().join("fixtures").join(kind)) {
            let fixture: Value = serde_json::from_str(&read(&path)).expect("fixture parses");
            let command = admit_command(&fixture["command"].to_string()).expect("command admits");
            assert_eq!(command.kind(), kind, "{}", path.display());
            assert_eq!(as_value(&command)["type"], kind, "{}", path.display());
            named.insert(kind);
        }
    }
    assert_eq!(named.len(), EXECUTED.len(), "every type has a fixture");
}
