//! The portable project envelope (OpenSpec `p1-envelope-inspector`, design E1–E3):
//! one versioned JSON object holding a project's editable scope, the stored
//! document fields outside it (`head`), and its asset manifest.
//!
//! Admission is pure. A controller admits an envelope before it replaces any
//! stored state with it, so a refusal leaves that state as it was. Admission
//! keeps the input value and swaps in the admitted scope, then refuses the
//! envelope if serializing it again would change any value.

use serde_json::{Map, Value};

use crate::error::EngineError;
use crate::schema::{EditScope, SUPPORTED_SCHEMA_VERSION, admit_scope};

pub const FORMAT: &str = "maleo.project";
pub const FORMAT_VERSION: u64 = 1;
const PROJECT_TYPES: [&str; 3] = ["video", "image", "text"];
/// `MAX_INLINE_IMAGE_CHARS` in `packages/shared/src/pending-media.ts`.
const MAX_INLINE_IMAGE_CHARS: usize = 64 * 1024;
const MEDIA_URL_PREFIX: &str = "/api/media/";
/// Stored-document keys the scope owns (`storyboardWithScope` writes them), so
/// `head` cannot carry them.
const SCOPE_KEYS: [&str; 12] =
    ["schemaVersion", "clips", "markers", "chapters", "bookmarks", "projectReferences", "materials", "captions", "captionSet", "trackFlags", "slides", "posts"];

/// Why admission refused an envelope. The wire names are a closed list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    WrongFormat,
    UnsupportedFormatVersion,
    UnsupportedSchema,
    InvalidField,
    MissingManifestEntry,
    DeviceUrl,
    UnpreservableField,
}

impl Reason {
    /// The wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WrongFormat => "wrong-format",
            Self::UnsupportedFormatVersion => "unsupported-format-version",
            Self::UnsupportedSchema => "unsupported-schema",
            Self::InvalidField => "invalid-field",
            Self::MissingManifestEntry => "missing-manifest-entry",
            Self::DeviceUrl => "device-url",
            Self::UnpreservableField => "unpreservable-field",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub reason: Reason,
    /// The field that caused the refusal, as `scope.doc.clips[0].video.url`.
    pub path: String,
    pub message: String,
}

fn refuse(reason: Reason, path: impl Into<String>, message: impl Into<String>) -> Refusal {
    Refusal { reason, path: path.into(), message: message.into() }
}

/// An admitted envelope: the input value, with its scope admitted by the engine.
#[derive(Clone, Debug, PartialEq)]
pub struct Envelope {
    value: Map<String, Value>,
    pub scope: EditScope,
}

impl Envelope {
    /// The envelope as JSON, with the admitted scope in place of the input scope.
    pub fn to_value(&self) -> Result<Value, String> {
        // Through the string writer the engine already carries, not a second `Value` serializer.
        let text = crate::json::to_js_string(&self.scope)?;
        let scope: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
        let mut value = self.value.clone();
        value.insert("scope".into(), scope);
        Ok(Value::Object(value))
    }
}

/// Admit an envelope, or name the first reason it cannot be preserved.
pub fn admit(json: &str) -> Result<Envelope, Refusal> {
    let input: Value = serde_json::from_str(json).map_err(|error| refuse(Reason::InvalidField, "", error.to_string()))?;
    let Value::Object(value) = &input else {
        return Err(refuse(Reason::InvalidField, "", "an envelope is a JSON object"));
    };
    check_header(value)?;
    let scope_value = value.get("scope").ok_or_else(|| refuse(Reason::InvalidField, "scope", "the envelope has no scope"))?;
    let scope = admit_scope(&scope_value.to_string()).map_err(|error| match error {
        EngineError::UnsupportedSchemaVersion(_) => refuse(Reason::UnsupportedSchema, "scope.doc.schemaVersion", error.to_string()),
        other => refuse(Reason::InvalidField, "scope", other.to_string()),
    })?;
    let head = value.get("head").ok_or_else(|| refuse(Reason::InvalidField, "head", "the envelope has no head"))?;
    let Value::Object(head_fields) = head else {
        return Err(refuse(Reason::InvalidField, "head", "head is a JSON object"));
    };
    if let Some(key) = head_fields.keys().find(|key| SCOPE_KEYS.contains(&key.as_str())) {
        return Err(refuse(Reason::UnpreservableField, format!("head.{key}"), "the scope owns this field, so rebuilding the document would replace it"));
    }
    let manifest = manifest_ids(value.get("manifest"))?;
    for (root, part) in [("scope", scope_value), ("head", head)] {
        check_device_urls(part, root)?;
    }
    check_manifest(scope_value, head, &manifest)?;
    let envelope = Envelope { value: value.clone(), scope };
    let output = envelope.to_value().map_err(|error| refuse(Reason::UnpreservableField, "scope", error))?;
    if let Some(path) = first_difference(&input, &output, "") {
        return Err(refuse(Reason::UnpreservableField, path, "the engine cannot preserve this field"));
    }
    Ok(envelope)
}

fn check_header(value: &Map<String, Value>) -> Result<(), Refusal> {
    if value.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(refuse(Reason::WrongFormat, "format", format!("format is not {FORMAT:?}")));
    }
    let version = value
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| refuse(Reason::InvalidField, "formatVersion", "formatVersion is a positive integer"))?;
    if version == 0 {
        return Err(refuse(Reason::InvalidField, "formatVersion", "formatVersion is a positive integer"));
    }
    if version > FORMAT_VERSION {
        return Err(refuse(
            Reason::UnsupportedFormatVersion,
            "formatVersion",
            format!("formatVersion {version} is newer than {FORMAT_VERSION}, the newest this engine reads"),
        ));
    }
    let compatibility =
        value.get("compatibility").and_then(Value::as_object).ok_or_else(|| refuse(Reason::InvalidField, "compatibility", "compatibility is a JSON object"))?;
    let reader = compatibility
        .get("minReaderVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| refuse(Reason::InvalidField, "compatibility.minReaderVersion", "minReaderVersion is a positive integer"))?;
    if reader > FORMAT_VERSION {
        return Err(refuse(
            Reason::UnsupportedFormatVersion,
            "compatibility.minReaderVersion",
            format!("this envelope needs reader version {reader}; this engine reads {FORMAT_VERSION}"),
        ));
    }
    let document = value.get("scope").and_then(|scope| scope.get("doc")).and_then(|doc| doc.get("schemaVersion"));
    if document.and_then(Value::as_u64) != Some(SUPPORTED_SCHEMA_VERSION) {
        return Err(refuse(
            Reason::UnsupportedSchema,
            "scope.doc.schemaVersion",
            format!("this engine admits document schemaVersion {SUPPORTED_SCHEMA_VERSION}"),
        ));
    }
    if compatibility.get("schemaVersion") != document {
        return Err(refuse(Reason::InvalidField, "compatibility.schemaVersion", "compatibility.schemaVersion names the document's schemaVersion"));
    }
    let project = value.get("project").and_then(Value::as_object).ok_or_else(|| refuse(Reason::InvalidField, "project", "project is a JSON object"))?;
    if !project.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty()) {
        return Err(refuse(Reason::InvalidField, "project.id", "project.id is a non-empty string"));
    }
    if !project.get("type").and_then(Value::as_str).is_some_and(|kind| PROJECT_TYPES.contains(&kind)) {
        return Err(refuse(Reason::InvalidField, "project.type", "project.type is video, image or text"));
    }
    if !project.get("title").is_some_and(Value::is_string) {
        return Err(refuse(Reason::InvalidField, "project.title", "project.title is a string"));
    }
    Ok(())
}

/// The identities the manifest lists. Each entry needs a string `id`, `url` and `state`.
fn manifest_ids(manifest: Option<&Value>) -> Result<Vec<String>, Refusal> {
    let entries = manifest.and_then(Value::as_array).ok_or_else(|| refuse(Reason::InvalidField, "manifest", "manifest is a JSON array"))?;
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            for key in ["id", "url", "state"] {
                if !entry.get(key).is_some_and(Value::is_string) {
                    return Err(refuse(Reason::InvalidField, format!("manifest[{index}].{key}"), format!("a manifest entry has a string {key}")));
                }
            }
            Ok(entry["id"].as_str().unwrap_or_default().to_owned())
        })
        .collect()
}

/// `MEDIA_FIELD` in `pending-media.ts`: `/(?:^|[a-z])(?:url|src|thumb|image)$/i`.
pub fn is_media_field(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    ["url", "src", "thumb", "image"]
        .iter()
        .any(|suffix| lower.strip_suffix(suffix).is_some_and(|rest| rest.is_empty() || rest.ends_with(|c: char| c.is_ascii_lowercase())))
}

/// The managed identity a stable media URL names (`mediaUrlId` in `media-id.ts`).
pub fn media_url_id(url: &str) -> Option<&str> {
    let id = url.strip_prefix(MEDIA_URL_PREFIX)?;
    (id.len() == 36 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')).then_some(id)
}

/// Every managed identity the scope and `head` reference, once each, in visit
/// order. This is the walk of `collectAssetReferences` in `asset-manifest.ts`:
/// every media field of the document, and only the `url` of a library entry.
pub fn managed_ids(scope: &Value, head: &Value) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    visit_references(scope, head, &mut |_, url| {
        if let Some(id) = media_url_id(url)
            && !ids.iter().any(|known| known == id)
        {
            ids.push(id.to_owned());
        }
        Ok(())
    })
    .ok();
    ids
}

fn visit_references(scope: &Value, head: &Value, note: &mut impl FnMut(&str, &str) -> Result<(), Refusal>) -> Result<(), Refusal> {
    for (key, field) in scope.as_object().into_iter().flatten() {
        if key != "mediaAssets" {
            visit_media(field, &format!("scope.{key}"), note)?;
            continue;
        }
        for (index, asset) in field.as_array().into_iter().flatten().enumerate() {
            if let Some(url) = asset.get("url").and_then(Value::as_str) {
                note(&format!("scope.mediaAssets[{index}].url"), url)?;
            }
        }
    }
    visit_media(head, "head", note)
}

fn visit_media(value: &Value, path: &str, note: &mut impl FnMut(&str, &str) -> Result<(), Refusal>) -> Result<(), Refusal> {
    match value {
        Value::Array(items) => items.iter().enumerate().try_for_each(|(index, item)| visit_media(item, &format!("{path}[{index}]"), note)),
        Value::Object(fields) => fields.iter().try_for_each(|(key, field)| {
            let at = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
            match field {
                Value::String(url) if is_media_field(key) => note(&at, url),
                other => visit_media(other, &at, note),
            }
        }),
        _ => Ok(()),
    }
}

/// Refuse device-only URLs anywhere (`localMediaUrlIssues` in `pending-media.ts`,
/// plus signed storage URLs).
fn check_device_urls(value: &Value, root: &str) -> Result<(), Refusal> {
    visit_media(value, root, &mut |path, url| {
        if url.starts_with("blob:") {
            return Err(refuse(Reason::DeviceUrl, path, "a blob: URL exists only in one browser tab"));
        }
        if url.starts_with("data:") && (!url.starts_with("data:image/") || url.len() > MAX_INLINE_IMAGE_CHARS) {
            return Err(refuse(Reason::DeviceUrl, path, "a data: URL here is not a small inline image"));
        }
        if url.contains("X-Amz-Signature=") {
            return Err(refuse(Reason::DeviceUrl, path, "a signed storage URL expires; use the stable media URL"));
        }
        Ok(())
    })
}

/// Refuse a referenced managed identity that the manifest does not list.
fn check_manifest(scope: &Value, head: &Value, manifest: &[String]) -> Result<(), Refusal> {
    visit_references(scope, head, &mut |path, url| match media_url_id(url) {
        Some(id) if !manifest.iter().any(|known| known == id) => {
            Err(refuse(Reason::MissingManifestEntry, path, format!("the manifest does not list media {id}")))
        }
        _ => Ok(()),
    })
}

/// The first path where two values differ as JavaScript sees JSON: key order is
/// not significant, and a number is its value.
fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    let at = |key: &str| if path.is_empty() { key.to_owned() } else { format!("{path}.{key}") };
    match (a, b) {
        (Value::Number(x), Value::Number(y)) if x.as_f64() == y.as_f64() => None,
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            x.iter().zip(y).enumerate().find_map(|(index, (x, y))| first_difference(x, y, &format!("{path}[{index}]")))
        }
        (Value::Object(x), Value::Object(y)) => x
            .iter()
            .find_map(|(key, value)| match y.get(key) {
                Some(other) => first_difference(value, other, &at(key)),
                None => Some(at(key)),
            })
            .or_else(|| y.keys().find(|key| !x.contains_key(*key)).map(|key| at(key))),
        _ if a == b => None,
        _ => Some(path.to_owned()),
    }
}

/// The whole boundary in one call: the admitted envelope as JSON, or the refusal as JSON.
pub fn admit_json(json: &str) -> Result<String, String> {
    match admit(json) {
        Ok(envelope) => envelope.to_value().and_then(|value| crate::json::to_js_string(&value)),
        // `kind` makes the refusal read as an engine error to hosts that only check `kind`.
        Err(Refusal { reason, path, message }) => {
            let refusal = serde_json::json!({ "kind": "EnvelopeRefused", "reason": reason.as_str(), "path": path, "message": message });
            Err(crate::json::to_js_string(&refusal).unwrap_or_else(|error| error))
        }
    }
}
