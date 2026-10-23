//! What the timeline editor has selected, ported from
//! `apps/web/src/models/timeline/selection-model.ts`.
//!
//! Pure: each action takes the current selection and returns the next. The
//! controller keeps the side effects a selection causes (seeking, a drawer).

use serde_json::{Map, Value, json};

/// Clip families that can be selected. `scene` and `caption` are toggle-only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipSource {
    Scene,
    Video,
    Text,
    Audio,
    Effect,
    Caption,
}

const SOURCES: [ClipSource; 6] = [ClipSource::Scene, ClipSource::Video, ClipSource::Text, ClipSource::Audio, ClipSource::Effect, ClipSource::Caption];

impl ClipSource {
    fn name(self) -> &'static str {
        match self {
            Self::Scene => "scene",
            Self::Video => "video",
            Self::Text => "text",
            Self::Audio => "audio",
            Self::Effect => "effect",
            Self::Caption => "caption",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Selection {
    pub scene_id: Option<f64>,
    /// The scene whose editor drawer is open. Cleared by every transition.
    pub editor_scene_id: Option<f64>,
    pub overlay_id: Option<f64>,
    pub audio_id: Option<f64>,
    pub video_overlay_id: Option<f64>,
    pub effect_id: Option<f64>,
    pub transition_id: Option<f64>,
    /// Multi-select keys, `source:refId`, in insertion order.
    pub free_ids: Vec<String>,
}

/// A selection transition, as a controller sends it.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    SelectScene {
        scene_id: f64,
    },
    /// Single click: `source` is not `scene` or `caption`.
    SelectClip {
        source: ClipSource,
        ref_id: f64,
    },
    ToggleClip {
        source: ClipSource,
        ref_id: f64,
    },
    SelectTransition {
        transition_id: f64,
    },
    Clear,
    OpenSceneEditor {
        scene_id: f64,
    },
}

/* The wire shapes are decoded by hand, like commands: serde's derived code for
 * a tagged enum is a large share of a WASM module. */

fn number(object: &Map<String, Value>, key: &str) -> Result<f64, String> {
    object.get(key).and_then(Value::as_f64).ok_or_else(|| format!("`{key}` is not a number"))
}

/// An absent or null id is no id.
fn optional(object: &Map<String, Value>, key: &str) -> Result<Option<f64>, String> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => number(object, key).map(Some),
    }
}

fn source(object: &Map<String, Value>) -> Result<ClipSource, String> {
    let name = object.get("source").and_then(Value::as_str).ok_or("`source` is not a string")?;
    SOURCES.into_iter().find(|source| source.name() == name).ok_or_else(|| format!("unknown clip source {name:?}"))
}

impl Action {
    /// `{"type": "selectScene" | "selectClip" | "toggleClip" | "selectTransition" | "clear" | "openSceneEditor", …}`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let object = value.as_object().ok_or("an action is a JSON object")?;
        let kind = object.get("type").and_then(Value::as_str).ok_or("an action needs a string `type`")?;
        Ok(match kind {
            "selectScene" => Self::SelectScene { scene_id: number(object, "sceneId")? },
            "selectClip" => Self::SelectClip { source: source(object)?, ref_id: number(object, "refId")? },
            "toggleClip" => Self::ToggleClip { source: source(object)?, ref_id: number(object, "refId")? },
            "selectTransition" => Self::SelectTransition { transition_id: number(object, "transitionId")? },
            "clear" => Self::Clear,
            "openSceneEditor" => Self::OpenSceneEditor { scene_id: number(object, "sceneId")? },
            other => return Err(format!("unknown selection action {other:?}")),
        })
    }
}

impl Selection {
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let object = value.as_object().ok_or("a selection is a JSON object")?;
        let free_ids = match object.get("freeIds") {
            None => Vec::new(),
            Some(ids) => ids
                .as_array()
                .ok_or("`freeIds` is not an array")?
                .iter()
                .map(|id| id.as_str().map(str::to_owned).ok_or("`freeIds` holds a non-string"))
                .collect::<Result<_, _>>()?,
        };
        Ok(Self {
            scene_id: optional(object, "sceneId")?,
            editor_scene_id: optional(object, "editorSceneId")?,
            overlay_id: optional(object, "overlayId")?,
            audio_id: optional(object, "audioId")?,
            video_overlay_id: optional(object, "videoOverlayId")?,
            effect_id: optional(object, "effectId")?,
            transition_id: optional(object, "transitionId")?,
            free_ids,
        })
    }

    /// The web shape: the two scene fields are omitted when unset, the rest are null.
    pub fn to_value(&self) -> Value {
        let mut out = json!({
            "overlayId": self.overlay_id,
            "audioId": self.audio_id,
            "videoOverlayId": self.video_overlay_id,
            "effectId": self.effect_id,
            "transitionId": self.transition_id,
            "freeIds": self.free_ids,
        });
        for (key, id) in [("sceneId", self.scene_id), ("editorSceneId", self.editor_scene_id)] {
            if let (Some(id), Some(object)) = (id, out.as_object_mut()) {
                object.insert(key.to_owned(), json!(id));
            }
        }
        out
    }
}

/// `source:refId`, the key the multi-select set and the DOM both use.
pub fn clip_key(source: ClipSource, ref_id: f64) -> String {
    format!("{}:{ref_id}", source.name())
}

fn only(source: ClipSource, family: ClipSource, ref_id: f64) -> Option<f64> {
    (source == family).then_some(ref_id)
}

/// Apply one action. Selecting one kind clears the others.
pub fn apply(current: &Selection, action: &Action) -> Result<Selection, String> {
    use ClipSource::{Audio, Effect, Text, Video};
    Ok(match *action {
        Action::SelectScene { scene_id } => Selection { scene_id: Some(scene_id), ..Selection::default() },
        Action::SelectClip { source: source @ (ClipSource::Scene | ClipSource::Caption), .. } => {
            return Err(format!("a {} clip is selected by toggling, not as primary", source.name()));
        }
        Action::SelectClip { source, ref_id } => Selection {
            overlay_id: only(source, Text, ref_id),
            audio_id: only(source, Audio, ref_id),
            video_overlay_id: only(source, Video, ref_id),
            effect_id: only(source, Effect, ref_id),
            free_ids: vec![clip_key(source, ref_id)],
            ..Selection::default()
        },
        // Shift-click.
        Action::ToggleClip { source, ref_id } => {
            let key = clip_key(source, ref_id);
            let free_ids = if current.free_ids.contains(&key) {
                current.free_ids.iter().filter(|id| **id != key).cloned().collect()
            } else {
                current.free_ids.iter().cloned().chain(std::iter::once(key)).collect()
            };
            Selection {
                scene_id: None,
                editor_scene_id: None,
                overlay_id: only(source, Text, ref_id),
                audio_id: only(source, Audio, ref_id),
                video_overlay_id: only(source, Video, ref_id),
                effect_id: only(source, Effect, ref_id),
                transition_id: None,
                free_ids,
            }
        }
        Action::SelectTransition { transition_id } => Selection { transition_id: Some(transition_id), ..Selection::default() },
        Action::Clear => Selection::default(),
        Action::OpenSceneEditor { scene_id } => Selection { scene_id: Some(scene_id), editor_scene_id: Some(scene_id), ..Selection::default() },
    })
}

/// The primary clip key, in a fixed family order; None for a scene, a transition or nothing.
pub fn primary_clip_key(selection: &Selection) -> Option<String> {
    [
        (ClipSource::Video, selection.video_overlay_id),
        (ClipSource::Text, selection.overlay_id),
        (ClipSource::Audio, selection.audio_id),
        (ClipSource::Effect, selection.effect_id),
    ]
    .into_iter()
    .find_map(|(source, id)| id.map(|id| clip_key(source, id)))
}

/// A clip is selected when it is primary or part of the multi-select set.
pub fn is_clip_selected(selection: &Selection, key: &str) -> bool {
    selection.free_ids.iter().any(|id| id == key) || primary_clip_key(selection).as_deref() == Some(key)
}

/// Whether two selections say the same thing: the set compares by membership.
pub fn selections_equal(a: &Selection, b: &Selection) -> bool {
    let fields = |s: &Selection| (s.scene_id, s.editor_scene_id, s.overlay_id, s.audio_id, s.video_overlay_id, s.effect_id, s.transition_id);
    fields(a) == fields(b) && a.free_ids.len() == b.free_ids.len() && a.free_ids.iter().all(|id| b.free_ids.contains(id))
}

/// True when nothing is selected: the inspector's empty state.
pub fn is_empty(selection: &Selection) -> bool {
    selection.scene_id.is_none() && selection.transition_id.is_none() && primary_clip_key(selection).is_none() && selection.free_ids.is_empty()
}
