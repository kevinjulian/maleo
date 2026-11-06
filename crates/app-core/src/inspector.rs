//! The inspector view-model (`p1-envelope-inspector` I3): which property groups a
//! clip offers and in what order, which one shows, and what the inspector is
//! about. Ports of `clip-property-groups.tsx`. A controller maps each group key
//! to its own label and icon.

/// The facts beyond the kind that decide a clip's groups.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GroupOptions {
    pub video_has_audio: bool,
    pub scene_has_video: bool,
}

/// Those facts, read off the selection: a b-roll video may carry audio, and a
/// scene has a timing group only when one of its visuals is a video.
pub fn group_options(video_overlay_kind: Option<&str>, scene_visual_kinds: &[&str]) -> GroupOptions {
    GroupOptions { video_has_audio: video_overlay_kind == Some("video"), scene_has_video: scene_visual_kinds.contains(&"video") }
}

/// What a clip of `kind` can be edited for, in the order an editor reaches for
/// it: its own content first and as the default, then where it sits, how it
/// composites, its sound and time, then optional treatments. An unknown kind has
/// no groups.
pub fn property_groups(kind: &str, options: GroupOptions) -> Vec<&'static str> {
    let groups: &[(&str, bool)] = match kind {
        "scene" => &[
            ("content", true),
            ("shot", true),
            ("transform", true),
            ("animation", true),
            ("blending", true),
            ("timing", options.scene_has_video),
            ("masks", true),
            ("adjust", true),
            ("background", true),
        ],
        "shape" | "text" => &[("content", true), ("transform", true), ("animation", true), ("blending", true), ("timing", true)],
        "broll" => &[
            ("content", true),
            ("transform", true),
            ("animation", true),
            ("blending", true),
            ("audio", options.video_has_audio),
            ("timing", true),
            ("masks", true),
            ("adjust", true),
            ("motion", true),
        ],
        "audio" => &[("levels", true), ("animation", true), ("timing", true), ("content", true)],
        "effect" => &[("effect", true)],
        "transition" => &[("transition", true)],
        _ => &[],
    };
    groups.iter().filter(|(_, offered)| *offered).map(|(key, _)| *key).collect()
}

/// The group to show, given the tab the operator last chose. A kind that lacks
/// the remembered group falls back to its first; no groups shows `content`.
pub fn active_group<'a>(groups: &[&'a str], remembered: &str) -> &'a str {
    groups.iter().find(|key| **key == remembered).or(groups.first()).copied().unwrap_or("content")
}

/// The five shape presets; a text clip with one of them is a shape.
pub const SHAPE_PRESETS: [&str; 5] = ["shape-rect", "shape-circle", "shape-triangle", "shape-star", "shape-cross"];

/// The selection families, in the order the inspector resolves them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SubjectInput<'a> {
    pub video_overlay: Option<Option<f64>>,
    pub audio: Option<Option<f64>>,
    pub text_preset: Option<Option<&'a str>>,
    pub effect: bool,
    pub transition: bool,
    pub scene: Option<Option<f64>>,
}

/// The one family the inspector is about, and its clip id when it has one.
///
/// The order is a precedence rule: a scene stays selected under a free clip,
/// so the free clip wins, or selecting a clip inside a scene would show the
/// scene's properties.
pub fn subject(input: &SubjectInput) -> Option<(&'static str, Option<String>)> {
    let id = |prefix: &str, id: &Option<f64>| id.map(|id| format!("{prefix}:{}", maleo_editor_core::json::js_number_string(id).unwrap_or_default()));
    if let Some(overlay) = &input.video_overlay {
        return Some(("broll", id("video", overlay)));
    }
    if let Some(audio) = &input.audio {
        return Some(("audio", id("audio", audio)));
    }
    if let Some(preset) = input.text_preset {
        let shape = preset.is_some_and(|preset| SHAPE_PRESETS.contains(&preset));
        return Some((if shape { "shape" } else { "text" }, None));
    }
    if input.effect {
        return Some(("effect", None));
    }
    if input.transition {
        return Some(("transition", None));
    }
    input.scene.as_ref().map(|scene| ("scene", id("scene", scene)))
}
