//! The editing scope, as the engine admits it.
//!
//! Typed where the engine reads or writes a field; everything else rides in a
//! passthrough map, so a field this build does not model survives admission,
//! execution and serialization unchanged (design decision 3). Fields are typed
//! as the commands that use them are ported; the rest of the clip payload stays
//! JSON until then.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::{EngineError, EngineResult};

/// The only `doc.schemaVersion` this engine admits.
pub const SUPPORTED_SCHEMA_VERSION: u64 = 2;

pub type Passthrough = Map<String, Value>;

/* Shared, immutable parts of a scope. Executing a command builds a new scope
 * that shares every part it did not change, so an edit costs the clip it
 * touches plus a pointer per clip, not a deep copy of the document (task 2.5
 * measured the deep copy at ~1.5 ms per edit on 600 clips). */
pub type Shared<T> = Arc<T>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EditScope {
    #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
    pub media_assets: Shared<Vec<Value>>,
    pub doc: EditorDoc,
    #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
    pub slides: Shared<Vec<Value>>,
    #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
    pub posts: Shared<Vec<Value>>,
    #[serde(flatten)]
    #[cfg_attr(feature = "typescript", ts(skip))]
    pub extra: Shared<Passthrough>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EditorDoc {
    /// Admitted only when it is 2; read as JSON so any other value can be named in the refusal.
    #[cfg_attr(feature = "typescript", ts(type = "2"))]
    pub schema_version: Value,
    pub clips: Vec<Shared<Clip>>,
    #[cfg_attr(feature = "typescript", ts(type = "unknown[]"))]
    pub markers: Shared<Vec<Value>>,
    #[serde(flatten)]
    #[cfg_attr(feature = "typescript", ts(skip))]
    pub extra: Shared<Passthrough>,
}

/// `ClipType`: a clip of any other type is refused at admission.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum ClipType {
    Image,
    Video,
    Text,
    Audio,
    Effect,
    Transition,
    Caption,
}

/// A timeline clip. Its payload (`video`, `text`, `audio`, `scene`, `vis`, …)
/// and authoring fields stay in `extra` until a ported command needs them typed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ClipType,
    pub start_sec: f64,
    pub duration_sec: f64,
    pub track: f64,
    #[serde(flatten)]
    #[cfg_attr(feature = "typescript", ts(skip))]
    pub extra: Passthrough,
}

impl Clip {
    /// A payload object (`video`, `audio`, …) when present and not null.
    pub fn payload(&self, key: &str) -> Option<&Passthrough> {
        self.extra.get(key).and_then(Value::as_object)
    }
}

/// Admit a scope: parse it and refuse a document version this engine does not
/// execute, before anything is mutated.
pub fn admit_scope(json: &str) -> EngineResult<EditScope> {
    let scope: EditScope = serde_json::from_str(json).map_err(|error| EngineError::InvalidInput(error.to_string()))?;
    check_version(&scope)?;
    crate::captions::validate_captions(&scope)?;
    Ok(scope)
}

pub fn check_version(scope: &EditScope) -> EngineResult<()> {
    match scope.doc.schema_version.as_u64() {
        Some(SUPPORTED_SCHEMA_VERSION) => Ok(()),
        _ => Err(EngineError::UnsupportedSchemaVersion(scope.doc.schema_version.to_string())),
    }
}
