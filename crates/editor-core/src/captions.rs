//! Canonical caption payloads. Clip placement remains on `Clip`; words are cue-local.
use serde::Serialize;
use serde_json::Value;

use crate::error::{EngineError, EngineResult};
use crate::keyframes::{js_space, js_trim};
use crate::schema::{Clip, ClipType, EditScope, Passthrough};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum CaptionTimingOrigin {
    Recognized,
    ScriptAssisted,
    Estimated,
    Imported,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionCueWord {
    pub text: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionSourceBinding {
    pub clip_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub visual_id: Option<String>,
    pub media_id: String,
    pub media_revision: String,
    pub source_start_sec: f64,
    pub source_end_sec: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionProtection {
    pub text: bool,
    pub timing: bool,
    pub segmentation: bool,
    pub style: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionProvenance {
    pub origin: CaptionTimingOrigin,
    pub word_timing_origin: CaptionTimingOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum CaptionStatus {
    Current,
    NeedsRefresh,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionCue {
    pub text: String,
    pub words: Vec<CaptionCueWord>,
    pub provenance: CaptionProvenance,
    pub sources: Vec<CaptionSourceBinding>,
    pub protection: CaptionProtection,
    pub revision: u32,
    pub group_id: String,
    pub status: CaptionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional, type = "unknown"))]
    pub style: Option<Passthrough>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionDeletedRange {
    pub id: String,
    pub group_id: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub sources: Vec<CaptionSourceBinding>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct CaptionSet {
    #[cfg_attr(feature = "typescript", ts(type = "true"))]
    pub initialized: bool,
    pub language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub detected_language: Option<String>,
    pub revision: u32,
    pub deleted_ranges: Vec<CaptionDeletedRange>,
    pub applied_run_ids: Vec<String>,
}

fn invalid(message: &str) -> EngineError {
    EngineError::InvalidInput(format!("Captions: {message}"))
}

fn interval(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end > start
}

fn object(value: &Value) -> EngineResult<&Passthrough> {
    value.as_object().ok_or_else(|| invalid("expected an object"))
}
fn field<'a>(value: &'a Value, key: &str) -> EngineResult<&'a Value> {
    object(value)?.get(key).ok_or_else(|| invalid(&format!("missing {key}")))
}
fn text<'a>(value: &'a Value, key: &str) -> EngineResult<&'a str> {
    field(value, key)?.as_str().filter(|s| !js_trim(s).is_empty()).ok_or_else(|| invalid(&format!("invalid {key}")))
}
fn optional_text(value: &Value, key: &str) -> EngineResult<()> {
    if value.get(key).is_some() {
        text(value, key)?;
    }
    Ok(())
}
fn number(value: &Value, key: &str) -> EngineResult<f64> {
    field(value, key)?.as_f64().filter(|n| n.is_finite()).ok_or_else(|| invalid(&format!("invalid {key}")))
}
fn list<'a>(value: &'a Value, key: &str) -> EngineResult<&'a Vec<Value>> {
    field(value, key)?.as_array().ok_or_else(|| invalid(&format!("invalid {key}")))
}
fn revision(value: &Value) -> EngineResult<()> {
    let revision = number(value, "revision")?;
    if revision < 0.0 || revision > u32::MAX as f64 || revision.fract() != 0.0 {
        return Err(invalid("invalid revision"));
    }
    Ok(())
}
fn bindings(value: &Value) -> EngineResult<&Vec<Value>> {
    let sources = list(value, "sources")?;
    for source in sources {
        for key in ["clipId", "mediaId", "mediaRevision"] {
            text(source, key)?;
        }
        optional_text(source, "visualId")?;
        if !interval(number(source, "sourceStartSec")?, number(source, "sourceEndSec")?) {
            return Err(invalid("invalid source interval"));
        }
    }
    Ok(sources)
}

/// Borrow JSON already parsed by admission; avoid a second deserialization tree per edit.
pub fn validate_caption_clip(clip: &Clip) -> EngineResult<Option<&Value>> {
    if clip.kind != ClipType::Caption {
        if clip.extra.contains_key("caption") {
            return Err(invalid("caption payload requires caption clip type"));
        }
        return Ok(None);
    }
    if js_trim(&clip.id).is_empty()
        || !interval(clip.start_sec, clip.start_sec + clip.duration_sec)
        || !clip.track.is_finite()
        || clip.track < 0.0
        || clip.track.fract() != 0.0
    {
        return Err(invalid("invalid cue placement"));
    }
    let cue = clip.extra.get("caption").ok_or_else(|| invalid("missing cue payload"))?;
    let authored = text(cue, "text")?;
    text(cue, "groupId")?;
    revision(cue)?;
    bindings(cue)?;
    if !["current", "needs-refresh"].contains(&text(cue, "status")?) {
        return Err(invalid("invalid cue status"));
    }
    let provenance = field(cue, "provenance")?;
    for key in ["origin", "wordTimingOrigin"] {
        if !["recognized", "script-assisted", "estimated", "imported", "manual"].contains(&text(provenance, key)?) {
            return Err(invalid("invalid timing origin"));
        }
    }
    for key in ["engine", "model", "runId"] {
        optional_text(provenance, key)?;
    }
    let protection = field(cue, "protection")?;
    for key in ["text", "timing", "segmentation", "style"] {
        if !field(protection, key)?.is_boolean() {
            return Err(invalid("invalid edit protection"));
        }
    }
    let mut previous_end = 0.0;
    let mut word_text = String::new();
    let words = list(cue, "words")?;
    for word in words {
        let start = number(word, "startSec")?;
        let end = number(word, "endSec")?;
        if !interval(start, end) || end > clip.duration_sec || start < previous_end {
            return Err(invalid("words must be ordered inside cue duration"));
        }
        previous_end = end;
        word_text.push_str(text(word, "text")?);
    }
    let without_space = |text: &str| text.chars().filter(|c| !js_space(*c)).collect::<String>();
    if !words.is_empty() && without_space(&word_text) != without_space(authored) {
        return Err(invalid("words must reference authored cue text"));
    }
    if let Some(style) = cue.get("style") {
        validate_style(object(style)?)?;
    }
    Ok(Some(cue))
}

pub fn validate_caption_set(value: &Value) -> EngineResult<()> {
    if field(value, "initialized")?.as_bool() != Some(true) {
        return Err(invalid("caption set must be initialized"));
    }
    text(value, "language")?;
    optional_text(value, "detectedLanguage")?;
    revision(value)?;
    for id in list(value, "appliedRunIds")? {
        if id.as_str().is_none_or(|s| js_trim(s).is_empty()) {
            return Err(invalid("invalid apply identity"));
        }
    }
    for range in list(value, "deletedRanges")? {
        text(range, "id")?;
        text(range, "groupId")?;
        bindings(range)?;
        if !interval(number(range, "startSec")?, number(range, "endSec")?) {
            return Err(invalid("invalid protected deletion range"));
        }
    }
    Ok(())
}

/// Current bindings resolve to live instances. Stale cues retain removed-source evidence.
pub fn validate_captions(scope: &EditScope) -> EngineResult<()> {
    let set = scope.doc.extra.get("captionSet");
    if let Some(set) = set {
        validate_caption_set(set)?;
    }
    for clip in &scope.doc.clips {
        let Some(cue) = validate_caption_clip(clip)? else { continue };
        if set.is_none() {
            return Err(invalid("caption clips require an initialized set"));
        }
        if text(cue, "status")? == "needs-refresh" {
            continue;
        }
        for binding in list(cue, "sources")? {
            let clip_id = text(binding, "clipId")?;
            let source = scope.doc.clips.iter().find(|c| c.id == clip_id).ok_or_else(|| invalid("source clip is missing"))?;
            if let Some(visual_id) = binding.get("visualId").and_then(Value::as_str) {
                let visual = source.payload("vis").and_then(|vis| vis.get("vclip")).filter(|v| v.get("id").and_then(Value::as_str) == Some(visual_id));
                let scene_visual = source
                    .payload("scene")
                    .and_then(|scene| scene.get("visualClips"))
                    .and_then(Value::as_array)
                    .and_then(|items| items.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(visual_id)));
                if visual.or(scene_visual).is_none_or(|v| v.get("kind").and_then(Value::as_str) != Some("video")) {
                    return Err(invalid("source visual is missing or is not video"));
                }
            } else if source.kind != ClipType::Audio && source.kind != ClipType::Video {
                return Err(invalid("source must be an audio or video clip"));
            }
        }
    }
    Ok(())
}

fn validate_style(style: &Passthrough) -> EngineResult<()> {
    for (key, value) in style {
        let valid = match key.as_str() {
            "enabled" | "italic" | "allCaps" => value.is_boolean(),
            "fontFamily" | "weight" | "style" | "chunkDuration" => value.as_str().is_some_and(|s| !js_trim(s).is_empty()),
            "fill" | "activeColor" | "stroke" | "background" | "shadow" => value.is_string(),
            "lines" => value.as_str().is_some_and(|s| ["Single Line", "Two Lines"].contains(&s)),
            "motion" => value.as_str().is_some_and(|s| ["None", "Fade", "Pop", "Slide Up"].contains(&s)),
            "preset" => value
                .as_str()
                .is_some_and(|s| ["standard", "yellow", "highlight", "blackOnWhite", "documentary", "tiktokPunch", "education", "karaoke"].contains(&s)),
            "fontSize" => value.as_f64().is_some_and(|n| n.is_finite() && n > 0.0),
            "maxWords" | "maxChars" => value.as_f64().is_some_and(|n| n.is_finite() && n > 0.0 && n.fract() == 0.0),
            "maxPauseMs" | "shadowBlur" | "shadowDistance" => value.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0),
            "verticalPosition" | "shadowOpacity" | "inactiveOpacity" => value.as_f64().is_some_and(|n| n.is_finite() && (0.0..=100.0).contains(&n)),
            "maxWidth" => value.as_f64().is_some_and(|n| n.is_finite() && n > 0.0 && n <= 100.0),
            "shadowAngle" => value.as_f64().is_some_and(f64::is_finite),
            _ => false,
        };
        if !valid {
            return Err(invalid(&format!("invalid style field {key}")));
        }
    }
    Ok(())
}

fn locked(scope: &EditScope, track: f64) -> bool {
    scope
        .doc
        .extra
        .get("trackFlags")
        .and_then(|flags| crate::json::js_number_string(track).and_then(|key| flags.get(key)))
        .and_then(|flags| flags.get("locked"))
        .and_then(Value::as_bool)
        == Some(true)
}

fn cue_mut(clip: &mut Clip) -> EngineResult<&mut Value> {
    clip.extra.get_mut("caption").ok_or_else(|| invalid("missing cue"))
}

pub(crate) fn bump(value: &mut Value) -> EngineResult<()> {
    let previous = number(value, "revision")?;
    if previous >= u32::MAX as f64 {
        return Err(invalid("revision limit reached"));
    }
    value["revision"] = Value::from(previous as u32 + 1);
    Ok(())
}

fn estimate(cue: &mut Value, duration: f64) -> EngineResult<()> {
    let authored = text(cue, "text")?;
    let tokens: Vec<&str> = authored.split(js_space).filter(|token| !token.is_empty()).collect();
    let total: usize = tokens.iter().map(|token| token.chars().count()).sum();
    let mut cursor = 0;
    let words = tokens
        .iter()
        .map(|token| {
            let start = cursor as f64 / total as f64 * duration;
            cursor += token.chars().count();
            serde_json::json!({"text":token,"startSec":start,"endSec":cursor as f64 / total as f64 * duration})
        })
        .collect::<Vec<_>>();
    cue["words"] = Value::Array(words);
    cue["provenance"]["wordTimingOrigin"] = Value::from("estimated");
    Ok(())
}

pub fn caption_inverse(scope: &EditScope, edit: &Value) -> EngineResult<crate::command::EditorCommand> {
    if text(edit, "action")? == "apply-result" && result_is_noop(scope, edit)? {
        return Ok(crate::command::EditorCommand::Noop);
    }
    let mut ids = if let Some(ids) = edit.get("ids") {
        ids.as_array().cloned().ok_or_else(|| invalid("invalid cue ids"))?
    } else if text(edit, "action")? == "create" {
        vec![field(field(edit, "clip")?, "id")?.clone()]
    } else {
        vec![field(edit, "id")?.clone()]
    };
    if text(edit, "action")? == "split" {
        ids.push(field(edit, "newId")?.clone());
    }
    if text(edit, "action")? == "apply-result" {
        for clip in list(edit, "candidates")? {
            let id = field(clip, "id")?.clone();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    let entries: Vec<Value> = scope
        .doc
        .clips
        .iter()
        .enumerate()
        .filter(|(_, clip)| ids.iter().any(|id| id.as_str() == Some(clip.id.as_str())))
        .map(|(index, clip)| serde_json::json!({"index":index,"clip":clip}))
        .collect();
    let mut inverse = serde_json::json!({"action":"restore","ids":ids,"entries":entries});
    if let Some(set) = scope.doc.extra.get("captionSet") {
        inverse["captionSet"] = set.clone();
    }
    Ok(crate::command::EditorCommand::CaptionEdit { edit: inverse })
}

fn result_is_noop(scope: &EditScope, edit: &Value) -> EngineResult<bool> {
    let run_id = text(edit, "runId")?;
    Ok(list(edit, "candidates")?.is_empty()
        || scope
            .doc
            .extra
            .get("captionSet")
            .and_then(|set| set.get("appliedRunIds"))
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(run_id))))
}

fn restore(scope: &EditScope, edit: &Value) -> EngineResult<EditScope> {
    use std::sync::Arc;
    let ids = list(edit, "ids")?;
    let mut next = scope.clone();
    for clip in &scope.doc.clips {
        if ids.iter().any(|id| id.as_str() == Some(clip.id.as_str())) && (clip.kind != ClipType::Caption || locked(scope, clip.track)) {
            return Err(invalid("restore requires unlocked caption tracks"));
        }
    }
    next.doc.clips.retain(|clip| !ids.iter().any(|id| id.as_str() == Some(clip.id.as_str())));
    let mut previous = None;
    for entry in list(edit, "entries")? {
        let index = number(entry, "index")?;
        if index < 0.0 || index.fract() != 0.0 || index > next.doc.clips.len() as f64 || previous.is_some_and(|prior| index <= prior) {
            return Err(invalid("invalid restore index"));
        }
        previous = Some(index);
        let clip: Clip = serde_json::from_value(field(entry, "clip")?.clone()).map_err(|_| invalid("invalid restore clip"))?;
        if clip.kind != ClipType::Caption
            || locked(scope, clip.track)
            || !ids.iter().any(|id| id.as_str() == Some(clip.id.as_str()))
            || next.doc.clips.iter().any(|item| item.id == clip.id)
        {
            return Err(invalid("invalid restore target"));
        }
        next.doc.clips.insert(index as usize, Arc::new(clip));
    }
    let fields = Arc::make_mut(&mut next.doc.extra);
    if let Some(set) = edit.get("captionSet") {
        fields.insert("captionSet".into(), set.clone());
    } else {
        fields.remove("captionSet");
    }
    validate_captions(&next)?;
    Ok(next)
}

/// Caption mutations own protection and set revisions. Generic scope undo restores exact prior JSON.
pub fn edit_captions(scope: &EditScope, edit: &Value) -> EngineResult<EditScope> {
    use std::sync::Arc;
    let action = text(edit, "action")?;
    let fields: &[&str] = match action {
        "create" => &["action", "clip", "language"],
        "update" => &["action", "id", "text"],
        "timing" => &["action", "id", "startSec", "durationSec"],
        "split" => &["action", "id", "at", "newId"],
        "merge" | "delete" | "unlink" => &["action", "ids"],
        "style" => &["action", "ids", "style"],
        "restore" => &["action", "ids", "entries", "captionSet"],
        "apply-result" => {
            &["action", "ids", "candidates", "runId", "language", "detectedLanguage", "startSec", "endSec", "sources", "snapshot", "replaceEdited"]
        }
        _ => return Err(invalid("unknown caption edit action")),
    };
    if object(edit)?.keys().any(|key| !fields.contains(&key.as_str())) {
        return Err(invalid("unknown caption edit field"));
    }
    if action == "restore" {
        return restore(scope, edit);
    }
    if action == "apply-result" && result_is_noop(scope, edit)? {
        return Ok(scope.clone());
    }
    let ids: Vec<&str> = if action == "create" {
        vec![]
    } else if edit.get("ids").is_some() {
        list(edit, "ids")?.iter().map(|id| id.as_str().ok_or_else(|| invalid("invalid cue id"))).collect::<EngineResult<_>>()?
    } else {
        vec![text(edit, "id")?]
    };
    if action != "create" && ((ids.is_empty() && action != "apply-result") || ids.iter().enumerate().any(|(index, id)| ids[..index].contains(id))) {
        return Err(invalid("select distinct caption cues"));
    }
    let selected: Vec<Clip> = ids
        .iter()
        .map(|id| {
            let clip = scope.doc.clips.iter().find(|clip| clip.id == *id && clip.kind == ClipType::Caption).ok_or_else(|| invalid("caption cue not found"))?;
            if locked(scope, clip.track) {
                return Err(invalid("caption track is locked"));
            }
            Ok(clip.as_ref().clone())
        })
        .collect::<EngineResult<_>>()?;
    let mut next = scope.clone();
    let mut set = scope
        .doc
        .extra
        .get("captionSet")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({"initialized":true,"language":"auto","revision":0,"deletedRanges":[],"appliedRunIds":[]}));
    let mut replacements = selected.clone();
    match action {
        "apply-result" => {
            bindings(edit)?;
            let (targets, merged) = crate::caption_results::merge(scope, edit, &mut set)?;
            if targets.iter().map(String::as_str).collect::<Vec<_>>() != ids {
                return Err(invalid("result scope targets changed"));
            }
            replacements = merged;
            for clip in &replacements {
                if locked(scope, clip.track) {
                    return Err(invalid("caption track is locked"));
                }
            }
            set["language"] = Value::from(text(edit, "language")?);
            optional_text(edit, "detectedLanguage")?;
            if let Some(language) = edit.get("detectedLanguage") {
                set["detectedLanguage"] = language.clone();
            } else {
                set.as_object_mut().expect("admitted caption set").remove("detectedLanguage");
            }
            set["appliedRunIds"].as_array_mut().ok_or_else(|| invalid("invalid apply identities"))?.push(Value::from(text(edit, "runId")?));
        }
        "create" => {
            let clip: Clip = serde_json::from_value(field(edit, "clip")?.clone()).map_err(|_| invalid("invalid caption clip"))?;
            if clip.kind != ClipType::Caption || scope.doc.clips.iter().any(|item| item.id == clip.id) {
                return Err(invalid("caption id already exists or has wrong type"));
            }
            if locked(scope, clip.track) {
                return Err(invalid("caption track is locked"));
            }
            validate_caption_clip(&clip)?;
            if let Some(language) = edit.get("language") {
                text(edit, "language")?;
                set["language"] = language.clone();
            }
            replacements.push(clip);
        }
        "update" => {
            let duration = replacements[0].duration_sec;
            let cue = cue_mut(&mut replacements[0])?;
            cue["text"] = Value::from(text(edit, "text")?);
            cue["provenance"]["origin"] = Value::from("manual");
            cue["protection"]["text"] = Value::Bool(true);
            estimate(cue, duration)?;
        }
        "timing" => {
            let clip = &mut replacements[0];
            let start = number(edit, "startSec")?;
            let duration = number(edit, "durationSec")?;
            if !interval(start, start + duration) {
                return Err(invalid("invalid cue timing"));
            }
            let scale = duration / clip.duration_sec;
            clip.start_sec = start;
            clip.duration_sec = duration;
            let cue = cue_mut(clip)?;
            crate::caption_sources::retime_bindings(scope, cue, start, duration)?;
            for word in cue["words"].as_array_mut().ok_or_else(|| invalid("invalid words"))? {
                word["startSec"] = Value::from(number(word, "startSec")? * scale);
                word["endSec"] = Value::from(number(word, "endSec")? * scale);
            }
            cue["protection"]["timing"] = Value::Bool(true);
            cue["provenance"]["wordTimingOrigin"] = Value::from("estimated");
        }
        "split" => {
            let clip = &mut replacements[0];
            let at = number(edit, "at")?;
            let new_id = text(edit, "newId")?;
            if scope.doc.clips.iter().any(|clip| clip.id == new_id) || at <= clip.start_sec || at >= clip.start_sec + clip.duration_sec {
                return Err(invalid("split needs an interior time and unused cue id"));
            }
            let duration = clip.duration_sec;
            let offset = at - clip.start_sec;
            let mut right = clip.clone();
            let cue = cue_mut(clip)?;
            if list(cue, "words")?.is_empty() {
                estimate(cue, duration)?;
            }
            let words = list(cue, "words")?;
            if words.len() < 2 {
                return Err(invalid("split needs at least two words"));
            }
            let boundary = (1..words.len())
                .min_by(|a, b| {
                    (number(&words[*a], "startSec").unwrap_or(0.0) - offset).abs().total_cmp(&(number(&words[*b], "startSec").unwrap_or(0.0) - offset).abs())
                })
                .ok_or_else(|| invalid("no word boundary"))?;
            let authored = text(cue, "text")?.to_owned();
            let mut cursor = 0;
            let mut split = 0;
            for (index, word) in words.iter().enumerate().take(boundary + 1) {
                let token = text(word, "text")?;
                let start = authored[cursor..].find(token).ok_or_else(|| invalid("word missing from cue text"))? + cursor;
                if index == boundary {
                    split = start;
                }
                cursor = start + token.len();
            }
            cue["text"] = Value::from(authored[..split].trim_end_matches(js_space));
            cue["protection"]["segmentation"] = Value::Bool(true);
            estimate(cue, offset)?;
            crate::caption_sources::retime_bindings(scope, cue, at - offset, offset)?;
            right.id = new_id.to_owned();
            right.start_sec = at;
            right.duration_sec = duration - offset;
            let right_cue = cue_mut(&mut right)?;
            right_cue["text"] = Value::from(&authored[split..]);
            right_cue["protection"]["segmentation"] = Value::Bool(true);
            estimate(right_cue, duration - offset)?;
            crate::caption_sources::retime_bindings(scope, right_cue, at, duration - offset)?;
            clip.duration_sec = offset;
            replacements.push(right);
        }
        "merge" => {
            if replacements.len() < 2 {
                return Err(invalid("merge needs adjacent cues"));
            }
            replacements.sort_by(|a, b| a.start_sec.total_cmp(&b.start_sec));
            let first = &replacements[0];
            let end = replacements.iter().map(|clip| clip.start_sec + clip.duration_sec).fold(0.0, f64::max);
            if replacements.iter().any(|clip| clip.track != first.track || clip.extra["caption"].get("style") != first.extra["caption"].get("style"))
                || scope.doc.clips.iter().any(|clip| {
                    clip.kind == ClipType::Caption
                        && clip.track == first.track
                        && !ids.contains(&clip.id.as_str())
                        && clip.start_sec < end
                        && clip.start_sec + clip.duration_sec > first.start_sec
                })
            {
                return Err(invalid("merge needs adjacent cues on one track with matching style"));
            }
            let mut merged = first.clone();
            merged.duration_sec = end - merged.start_sec;
            let authored = replacements.iter().map(|clip| text(&clip.extra["caption"], "text")).collect::<EngineResult<Vec<_>>>()?.join("\n");
            let mut sources: Vec<Value> = Vec::new();
            for clip in &replacements {
                for binding in list(&clip.extra["caption"], "sources")? {
                    if let Some(existing) = sources
                        .iter_mut()
                        .find(|existing| ["clipId", "visualId", "mediaId", "mediaRevision"].iter().all(|key| existing.get(key) == binding.get(key)))
                    {
                        existing["sourceStartSec"] = Value::from(number(existing, "sourceStartSec")?.min(number(binding, "sourceStartSec")?));
                        existing["sourceEndSec"] = Value::from(number(existing, "sourceEndSec")?.max(number(binding, "sourceEndSec")?));
                    } else {
                        sources.push(binding.clone());
                    }
                }
            }
            let duration = merged.duration_sec;
            let cue = cue_mut(&mut merged)?;
            cue["text"] = Value::from(authored);
            cue["sources"] = Value::Array(sources);
            cue["protection"]["segmentation"] = Value::Bool(true);
            estimate(cue, duration)?;
            replacements = vec![merged];
        }
        "delete" => {
            let ranges = set["deletedRanges"].as_array_mut().ok_or_else(|| invalid("invalid deleted ranges"))?;
            for clip in &selected {
                let cue = &clip.extra["caption"];
                ranges.push(serde_json::json!({"id":clip.id,"groupId":cue["groupId"],"startSec":clip.start_sec,"endSec":clip.start_sec+clip.duration_sec,"sources":cue["sources"]}));
            }
            replacements.clear();
        }
        "style" => {
            let style = field(edit, "style")?;
            if !style.is_null() {
                validate_style(object(style)?)?;
            }
            for clip in &mut replacements {
                let cue = cue_mut(clip)?;
                if style.is_null() {
                    cue.as_object_mut().ok_or_else(|| invalid("invalid cue"))?.remove("style");
                } else {
                    cue["style"] = style.clone();
                }
                cue["protection"]["style"] = Value::Bool(!style.is_null());
            }
        }
        "unlink" => {
            for clip in &mut replacements {
                let cue = cue_mut(clip)?;
                cue["sources"] = serde_json::json!([]);
                cue["status"] = Value::from("current");
                cue["protection"]["timing"] = Value::Bool(true);
            }
        }
        _ => return Err(invalid("unknown action")),
    }
    for clip in &mut replacements {
        if action != "apply-result" || !selected.iter().any(|prior| prior == clip) {
            bump(cue_mut(clip)?)?;
        }
    }
    bump(&mut set)?;
    let additions: Vec<_> = replacements.iter().filter(|clip| !ids.contains(&clip.id.as_str())).cloned().map(Arc::new).collect();
    next.doc.clips = scope
        .doc
        .clips
        .iter()
        .flat_map(|clip| {
            let mut output = if ids.contains(&clip.id.as_str()) {
                replacements.iter().find(|replacement| replacement.id == clip.id).cloned().map(Arc::new).into_iter().collect::<Vec<_>>()
            } else {
                vec![clip.clone()]
            };
            if action == "split" && ids.contains(&clip.id.as_str()) {
                output.extend(additions.clone());
            }
            output
        })
        .collect();
    if action == "create" || action == "apply-result" {
        next.doc.clips.extend(additions);
    }
    Arc::make_mut(&mut next.doc.extra).insert("captionSet".to_owned(), set);
    validate_captions(&next)?;
    Ok(next)
}
