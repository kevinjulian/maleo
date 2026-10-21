//! The command vocabulary, and admission of a command before it executes.
//!
//! The wire shape is the TS `EditorCommand`: a JSON object with a `type` and its
//! arguments, pinned by `packages/shared/src/editor/fixtures/`. Admission tells
//! three refusals apart, because a host reports them differently: a type that
//! does not exist, a field the type does not define, and a real command this
//! build does not execute yet.
//!
//! Optional arguments keep JavaScript's distinction between an absent field and
//! `null`: `{"type":"doc.setCaptions"}` clears the captions, while
//! `{"type":"doc.setCaptions","captions":null}` stores `null`, and an inverse
//! echoes whichever the prior scope held.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::{EngineError, EngineResult};
use crate::schema::{Clip, EditScope, Passthrough, check_version};

/// Every command type in the vocabulary (`EDITOR_COMMAND_TYPES` in TS).
pub const COMMAND_TYPES: [&str; 31] = [
    "caption.edit",
    "media.update",
    "media.admit",
    "clip.replace",
    "clip.trim-before",
    "clip.trim-after",
    "clip.insert",
    "clip.remove",
    "clip.update",
    "clip.move",
    "clip.resize",
    "clip.setKeys",
    "marker.upsert",
    "marker.remove",
    "marker.update",
    "bookmark.set",
    "bookmark.upsert",
    "bookmark.remove",
    "doc.setCaptions",
    "doc.setProjectReferences",
    "doc.setMaterials",
    "doc.setTrackFlags",
    "slide.insert",
    "slide.remove",
    "slide.update",
    "post.insert",
    "post.remove",
    "post.update",
    "batch",
    "scope.replace",
    "noop",
];

/// Serialized as the TS wire shape; admitted by `admit_command_value`, which
/// decodes each variant by hand rather than through a derived `Deserialize`:
/// serde buffers an internally tagged enum through a generic content tree, and
/// that code was most of the WASM module's growth past its size budget.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum EditorCommand {
    #[serde(rename = "caption.edit")]
    CaptionEdit {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        edit: Value,
    },
    #[serde(rename = "media.update", rename_all = "camelCase")]
    MediaUpdate {
        #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
        media_assets: Vec<Value>,
    },
    #[serde(rename = "media.admit")]
    MediaAdmit {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        asset: Value,
    },
    #[serde(rename = "clip.replace")]
    ClipReplace { id: String, clip: Clip },
    #[serde(rename = "clip.trim-before")]
    ClipTrimBefore { id: String, at: f64 },
    #[serde(rename = "clip.trim-after")]
    ClipTrimAfter { id: String, at: f64 },
    #[serde(rename = "clip.insert")]
    ClipInsert {
        clip: Clip,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional))]
        index: Option<f64>,
    },
    #[serde(rename = "clip.remove")]
    ClipRemove { id: String },
    #[serde(rename = "clip.update")]
    ClipUpdate {
        id: String,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        patch: Passthrough,
    },
    #[serde(rename = "clip.resize", rename_all = "camelCase")]
    ClipResize {
        id: String,
        duration_sec: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional))]
        start_sec: Option<f64>,
    },
    #[serde(rename = "clip.setKeys")]
    ClipSetKeys {
        id: String,
        property: String,
        #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
        keys: Vec<Value>,
    },
    #[serde(rename = "clip.move")]
    ClipMove {
        id: String,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        patch: Passthrough,
    },
    #[serde(rename = "marker.upsert")]
    MarkerUpsert {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        marker: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional))]
        index: Option<f64>,
    },
    #[serde(rename = "marker.remove")]
    MarkerRemove { id: f64 },
    #[serde(rename = "marker.update")]
    MarkerUpdate {
        id: f64,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        patch: Passthrough,
    },
    #[serde(rename = "bookmark.set")]
    BookmarkSet {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
        bookmarks: Option<Value>,
    },
    #[serde(rename = "bookmark.upsert")]
    BookmarkUpsert {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        bookmark: Value,
    },
    #[serde(rename = "bookmark.remove")]
    BookmarkRemove { id: String },
    #[serde(rename = "doc.setCaptions")]
    DocSetCaptions {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
        captions: Option<Value>,
    },
    #[serde(rename = "doc.setProjectReferences", rename_all = "camelCase")]
    DocSetProjectReferences {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
        project_references: Option<Value>,
    },
    #[serde(rename = "doc.setMaterials")]
    DocSetMaterials {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
        materials: Option<Value>,
    },
    #[serde(rename = "doc.setTrackFlags", rename_all = "camelCase")]
    DocSetTrackFlags {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
        track_flags: Option<Value>,
    },
    #[serde(rename = "slide.insert")]
    SlideInsert {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        slide: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional))]
        index: Option<f64>,
    },
    #[serde(rename = "slide.remove")]
    SlideRemove { id: f64 },
    #[serde(rename = "slide.update")]
    SlideUpdate {
        id: f64,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        patch: Passthrough,
    },
    #[serde(rename = "post.insert")]
    PostInsert {
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        post: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional))]
        index: Option<f64>,
    },
    #[serde(rename = "post.remove")]
    PostRemove { id: f64 },
    #[serde(rename = "post.update")]
    PostUpdate {
        id: f64,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        patch: Passthrough,
    },
    #[serde(rename = "batch")]
    Batch {
        commands: Vec<EditorCommand>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "string"))]
        label: Option<Value>,
    },
    #[serde(rename = "scope.replace")]
    ScopeReplace {
        scope: EditScope,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "typescript", ts(optional, type = "string"))]
        label: Option<Value>,
    },
    #[serde(rename = "noop")]
    Noop,
}

/// The fields each executed type defines, besides `type`.
fn fields_of(kind: &str) -> Option<&'static [&'static str]> {
    match kind {
        "caption.edit" => Some(&["edit"]),
        "media.update" => Some(&["mediaAssets"]),
        "media.admit" => Some(&["asset"]),
        "clip.replace" => Some(&["id", "clip"]),
        "clip.trim-before" | "clip.trim-after" => Some(&["id", "at"]),
        "clip.insert" => Some(&["clip", "index"]),
        "clip.resize" => Some(&["id", "durationSec", "startSec"]),
        "clip.setKeys" => Some(&["id", "property", "keys"]),
        "clip.remove" | "marker.remove" | "bookmark.remove" | "slide.remove" | "post.remove" => Some(&["id"]),
        "clip.update" | "clip.move" | "marker.update" | "slide.update" | "post.update" => Some(&["id", "patch"]),
        "marker.upsert" => Some(&["marker", "index"]),
        "bookmark.set" => Some(&["bookmarks"]),
        "bookmark.upsert" => Some(&["bookmark"]),
        "doc.setCaptions" => Some(&["captions"]),
        "doc.setProjectReferences" => Some(&["projectReferences"]),
        "doc.setMaterials" => Some(&["materials"]),
        "doc.setTrackFlags" => Some(&["trackFlags"]),
        "slide.insert" => Some(&["slide", "index"]),
        "post.insert" => Some(&["post", "index"]),
        "batch" => Some(&["commands", "label"]),
        "scope.replace" => Some(&["scope", "label"]),
        "noop" => Some(&[]),
        _ => None,
    }
}

/// Admit a command: known type, executed by this build, no undefined fields.
pub fn admit_command(json: &str) -> EngineResult<EditorCommand> {
    let value: Value = serde_json::from_str(json).map_err(|error| EngineError::InvalidInput(error.to_string()))?;
    admit_command_value(value)
}

pub fn admit_command_value(value: Value) -> EngineResult<EditorCommand> {
    let object = value.as_object().ok_or_else(|| EngineError::InvalidInput("a command is a JSON object".to_owned()))?;
    let kind = object.get("type").and_then(Value::as_str).ok_or_else(|| EngineError::InvalidInput("a command needs a string `type`".to_owned()))?.to_owned();
    if !COMMAND_TYPES.contains(&kind.as_str()) {
        return Err(EngineError::UnknownCommand(kind));
    }
    let fields = fields_of(&kind).ok_or_else(|| EngineError::NotPorted(kind.clone()))?;
    if let Some(field) = object.keys().find(|key| key.as_str() != "type" && !fields.contains(&key.as_str())) {
        return Err(EngineError::UnknownCommandField { command: kind, field: field.clone() });
    }
    decode(&kind, object)
}

/// The fields of one admitted command, read with the JSON rules the TS wire
/// contract uses: a number field takes any JSON number, an optional number is
/// absent or `null` for "not given", and an optional value keeps `null`.
struct Fields<'a> {
    kind: &'a str,
    object: &'a Map<String, Value>,
}

impl Fields<'_> {
    fn invalid(&self, name: &str, what: &str) -> EngineError {
        EngineError::InvalidInput(format!("{}: `{name}` {what}", self.kind))
    }
    fn required(&self, name: &str) -> EngineResult<&Value> {
        self.object.get(name).ok_or_else(|| self.invalid(name, "is missing"))
    }
    fn string(&self, name: &str) -> EngineResult<String> {
        self.required(name)?.as_str().map(str::to_owned).ok_or_else(|| self.invalid(name, "is not a string"))
    }
    fn float(&self, name: &str) -> EngineResult<f64> {
        self.required(name)?.as_f64().ok_or_else(|| self.invalid(name, "is not a number"))
    }
    fn index(&self, name: &str) -> EngineResult<Option<f64>> {
        match self.object.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value.as_f64().map(Some).ok_or_else(|| self.invalid(name, "is not a number")),
        }
    }
    fn value(&self, name: &str) -> EngineResult<Value> {
        self.required(name).cloned()
    }
    fn present(&self, name: &str) -> Option<Value> {
        self.object.get(name).cloned()
    }
    fn patch(&self, name: &str) -> EngineResult<Passthrough> {
        self.required(name)?.as_object().cloned().ok_or_else(|| self.invalid(name, "is not an object"))
    }
    fn list(&self, name: &str) -> EngineResult<Vec<Value>> {
        self.required(name)?.as_array().cloned().ok_or_else(|| self.invalid(name, "is not an array"))
    }
    fn clip(&self, name: &str) -> EngineResult<Clip> {
        serde_json::from_value(self.value(name)?).map_err(|error| self.invalid(name, &error.to_string()))
    }
}

fn decode(kind: &str, object: &Map<String, Value>) -> EngineResult<EditorCommand> {
    let f = Fields { kind, object };
    Ok(match kind {
        "caption.edit" => EditorCommand::CaptionEdit { edit: f.value("edit")? },
        "media.update" => EditorCommand::MediaUpdate { media_assets: f.list("mediaAssets")? },
        "media.admit" => EditorCommand::MediaAdmit { asset: f.value("asset")? },
        "clip.replace" => EditorCommand::ClipReplace { id: f.string("id")?, clip: f.clip("clip")? },
        "clip.trim-before" => EditorCommand::ClipTrimBefore { id: f.string("id")?, at: f.float("at")? },
        "clip.trim-after" => EditorCommand::ClipTrimAfter { id: f.string("id")?, at: f.float("at")? },
        "clip.insert" => EditorCommand::ClipInsert { clip: f.clip("clip")?, index: f.index("index")? },
        "clip.remove" => EditorCommand::ClipRemove { id: f.string("id")? },
        "clip.update" => EditorCommand::ClipUpdate { id: f.string("id")?, patch: f.patch("patch")? },
        "clip.resize" => EditorCommand::ClipResize { id: f.string("id")?, duration_sec: f.float("durationSec")?, start_sec: f.index("startSec")? },
        "clip.setKeys" => EditorCommand::ClipSetKeys { id: f.string("id")?, property: f.string("property")?, keys: f.list("keys")? },
        "clip.move" => EditorCommand::ClipMove { id: f.string("id")?, patch: f.patch("patch")? },
        "marker.upsert" => EditorCommand::MarkerUpsert { marker: f.value("marker")?, index: f.index("index")? },
        "marker.remove" => EditorCommand::MarkerRemove { id: f.float("id")? },
        "marker.update" => EditorCommand::MarkerUpdate { id: f.float("id")?, patch: f.patch("patch")? },
        "bookmark.set" => EditorCommand::BookmarkSet { bookmarks: f.present("bookmarks") },
        "bookmark.upsert" => EditorCommand::BookmarkUpsert { bookmark: f.value("bookmark")? },
        "bookmark.remove" => EditorCommand::BookmarkRemove { id: f.string("id")? },
        "doc.setCaptions" => EditorCommand::DocSetCaptions { captions: f.present("captions") },
        "doc.setProjectReferences" => EditorCommand::DocSetProjectReferences { project_references: f.present("projectReferences") },
        "doc.setMaterials" => EditorCommand::DocSetMaterials { materials: f.present("materials") },
        "doc.setTrackFlags" => EditorCommand::DocSetTrackFlags { track_flags: f.present("trackFlags") },
        "slide.insert" => EditorCommand::SlideInsert { slide: f.value("slide")?, index: f.index("index")? },
        "slide.remove" => EditorCommand::SlideRemove { id: f.float("id")? },
        "slide.update" => EditorCommand::SlideUpdate { id: f.float("id")?, patch: f.patch("patch")? },
        "post.insert" => EditorCommand::PostInsert { post: f.value("post")?, index: f.index("index")? },
        "post.remove" => EditorCommand::PostRemove { id: f.float("id")? },
        "post.update" => EditorCommand::PostUpdate { id: f.float("id")?, patch: f.patch("patch")? },
        // A batch's steps are commands too: each is admitted by the same rules, so
        // an unknown type or field inside one is refused before anything executes.
        "batch" => EditorCommand::Batch {
            commands: f.list("commands")?.into_iter().map(admit_command_value).collect::<EngineResult<Vec<_>>>()?,
            label: f.present("label"),
        },
        // A replacement scope is a whole document about to be written: refuse a
        // version this engine does not execute before it overwrites anything.
        "scope.replace" => {
            let scope: EditScope = serde_json::from_value(f.value("scope")?).map_err(|error| f.invalid("scope", &error.to_string()))?;
            check_version(&scope)?;
            crate::captions::validate_captions(&scope)?;
            EditorCommand::ScopeReplace { scope, label: f.present("label") }
        }
        "noop" => EditorCommand::Noop,
        _ => return Err(EngineError::NotPorted(kind.to_owned())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusals_are_distinct() {
        assert_eq!(admit_command(r#"{"type":"clip.teleport","id":"a"}"#), Err(EngineError::UnknownCommand("clip.teleport".into())));
        assert_eq!(
            admit_command(r#"{"type":"clip.trim-after","id":"a","at":1,"ripple":true}"#),
            Err(EngineError::UnknownCommandField { command: "clip.trim-after".into(), field: "ripple".into() })
        );
        assert!(matches!(admit_command(r#"{"type":"clip.trim-after","id":"a","at":"soon"}"#), Err(EngineError::InvalidInput(_))));
        assert!(matches!(admit_command("[]"), Err(EngineError::InvalidInput(_))));
    }

    #[test]
    fn admits_and_round_trips_executed_types() {
        let noop = admit_command(r#"{"type":"noop"}"#).expect("noop admits");
        assert_eq!(serde_json::to_string(&noop).expect("serializes"), r#"{"type":"noop"}"#);
        let trim = admit_command(r#"{"type":"clip.trim-before","id":"video:1","at":3.5}"#).expect("trim admits");
        assert_eq!(trim, EditorCommand::ClipTrimBefore { id: "video:1".into(), at: 3.5 });
    }

    #[test]
    fn absent_and_null_stay_distinct() {
        let cleared = admit_command(r#"{"type":"doc.setCaptions"}"#).expect("admits");
        assert_eq!(cleared, EditorCommand::DocSetCaptions { captions: None });
        assert_eq!(serde_json::to_string(&cleared).expect("serializes"), r#"{"type":"doc.setCaptions"}"#);
        let nulled = admit_command(r#"{"type":"doc.setCaptions","captions":null}"#).expect("admits");
        assert_eq!(nulled, EditorCommand::DocSetCaptions { captions: Some(Value::Null) });
        assert_eq!(serde_json::to_string(&nulled).expect("serializes"), r#"{"type":"doc.setCaptions","captions":null}"#);
    }

    #[test]
    fn batch_steps_are_admitted_like_commands() {
        assert_eq!(
            admit_command(r#"{"type":"batch","commands":[{"type":"noop"},{"type":"clip.teleport"}]}"#),
            Err(EngineError::UnknownCommand("clip.teleport".into()))
        );
        assert_eq!(
            admit_command(r#"{"type":"batch","commands":[{"type":"noop","extra":1}]}"#),
            Err(EngineError::UnknownCommandField { command: "noop".into(), field: "extra".into() })
        );
        assert!(admit_command(r#"{"type":"batch","commands":[{"type":"noop"}],"label":"x"}"#).is_ok());
    }

    #[test]
    fn a_replacement_scope_of_another_version_is_refused_before_it_overwrites() {
        let command = |version: u64| {
            format!(
                r#"{{"type":"scope.replace","scope":{{"mediaAssets":[],"slides":[],"posts":[],"doc":{{"schemaVersion":{version},"clips":[],"markers":[]}}}}}}"#
            )
        };
        assert!(admit_command(&command(2)).is_ok());
        assert_eq!(admit_command(&command(3)), Err(EngineError::UnsupportedSchemaVersion("3".into())));
    }
}
