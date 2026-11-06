//! The envelope against its shared fixtures (`packages/shared/src/editor/envelope-fixtures/`),
//! which the web wrapper runs too.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use maleo_editor_core::envelope::{admit, admit_json};
use serde_json::{Value, json};

fn editor_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/shared/src/editor")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Each case directory, sorted, as (name, input text, expected).
fn cases() -> Vec<(String, String, Value)> {
    let root = editor_dir().join("envelope-fixtures");
    let mut dirs: Vec<PathBuf> = fs::read_dir(&root).expect("fixtures dir").map(|entry| entry.expect("entry").path()).filter(|path| path.is_dir()).collect();
    dirs.sort();
    dirs.into_iter()
        .map(|dir| {
            let name = dir.file_name().expect("name").to_string_lossy().into_owned();
            let input = fs::read_to_string(dir.join("input.json")).expect("input.json");
            (name, input, read_json(&dir.join("expected.json")))
        })
        .collect()
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

#[test]
fn every_fixture_admits_or_refuses_as_recorded() {
    let cases = cases();
    assert!(cases.len() >= 12, "the fixture set is present");
    for (name, input, expected) in cases {
        match (admit_json(&input), expected.get("refusal")) {
            (Ok(text), None) => {
                let output: Value = serde_json::from_str(&text).expect("output parses");
                assert!(same(&output, &expected["envelope"]), "{name}: the round trip changed a value");
            }
            (Err(text), Some(refusal)) => {
                let got: Value = serde_json::from_str(&text).expect("refusal parses");
                assert_eq!((&got["reason"], &got["path"]), (&refusal["reason"], &refusal["path"]), "{name}: {got}");
                assert!(got["message"].as_str().is_some_and(|message| !message.is_empty()), "{name}: the refusal explains itself");
            }
            (Ok(_), Some(refusal)) => panic!("{name}: admitted, expected {refusal}"),
            (Err(text), None) => panic!("{name}: refused with {text}"),
        }
    }
}

#[test]
fn every_refusal_reason_has_a_fixture() {
    let covered: BTreeSet<String> = cases().into_iter().filter_map(|(_, _, expected)| expected["refusal"]["reason"].as_str().map(str::to_owned)).collect();
    let all =
        ["wrong-format", "unsupported-format-version", "unsupported-schema", "invalid-field", "missing-manifest-entry", "device-url", "unpreservable-field"];
    assert_eq!(covered, all.iter().map(|reason| (*reason).to_owned()).collect::<BTreeSet<_>>());
}

#[test]
fn every_round_trip_keeps_its_number_text() {
    for (name, input, expected) in cases() {
        if expected.get("refusal").is_some() {
            continue;
        }
        let output = admit_json(&input).expect("admits");
        let written: Value = serde_json::from_str(&input).expect("parses");
        assert_eq!(output, maleo_editor_core::json::to_js_string(&written).expect("writes"), "{name}: serialization moved a byte");
    }
}

#[test]
fn every_corpus_scope_admits_inside_an_envelope() {
    let dir = editor_dir().join("corpus").join("scopes");
    let mut checked = 0;
    for entry in fs::read_dir(&dir).expect("corpus dir") {
        let scope = read_json(&entry.expect("entry").path());
        let kind = if !scope["slides"].as_array().is_none_or(Vec::is_empty) {
            "image"
        } else if !scope["posts"].as_array().is_none_or(Vec::is_empty) {
            "text"
        } else {
            "video"
        };
        let envelope = json!({
            "format": "maleo.project", "formatVersion": 1,
            "compatibility": { "schemaVersion": 2, "minReaderVersion": 1 },
            "project": { "id": "corpus", "type": kind, "title": "" },
            "scope": scope, "head": {}, "manifest": []
        });
        let admitted = admit(&envelope.to_string()).unwrap_or_else(|refusal| panic!("{refusal:?}"));
        assert!(same(&admitted.to_value().expect("serializes"), &envelope));
        checked += 1;
    }
    assert!(checked > 0);
}

/// The Rust walk finds the identities the TS manifest walk recorded in
/// `managed-ids.reference.json` (`envelope-references.test.ts` pins the TS side).
#[test]
fn the_media_walk_matches_the_manifest_reference() {
    let dir = editor_dir();
    let reference = read_json(&dir.join("envelope-fixtures").join("managed-ids.reference.json"));
    let entries = reference.as_object().expect("an object");
    assert!(entries.len() > 100, "the reference is recorded");
    for (name, expected) in entries {
        let (file, key) = name.split_once('#').unwrap_or((name, ""));
        let (scope, head) = if let Some(case) = file.strip_prefix("envelope-fixtures/") {
            let envelope = read_json(&dir.join("envelope-fixtures").join(case).join("input.json"));
            (envelope["scope"].clone(), envelope["head"].clone())
        } else if key.is_empty() {
            (read_json(&dir.join(file)), json!({}))
        } else {
            (read_json(&dir.join(file))[key].clone(), json!({}))
        };
        let mut ids = maleo_editor_core::envelope::managed_ids(&scope, &head);
        ids.sort();
        assert_eq!(serde_json::to_value(&ids).expect("ids"), *expected, "{name}");
    }
}
