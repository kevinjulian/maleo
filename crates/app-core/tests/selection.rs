//! Twins of `apps/web/src/models/timeline/selection-model.test.ts`, case for case.

use maleo_app_core::selection::{Action, ClipSource, Selection, apply, clip_key, is_clip_selected, is_empty, primary_clip_key, selections_equal};

use ClipSource::{Audio, Effect, Scene, Text, Video};

fn act(current: &Selection, action: Action) -> Selection {
    apply(current, &action).expect("applies")
}

fn none() -> Selection {
    Selection::default()
}

fn select_scene(scene_id: f64) -> Selection {
    act(&none(), Action::SelectScene { scene_id })
}

fn select_clip(source: ClipSource, ref_id: f64) -> Selection {
    act(&none(), Action::SelectClip { source, ref_id })
}

fn toggle(current: &Selection, source: ClipSource, ref_id: f64) -> Selection {
    act(current, Action::ToggleClip { source, ref_id })
}

fn open_scene_editor(scene_id: f64) -> Selection {
    act(&none(), Action::OpenSceneEditor { scene_id })
}

fn primary(selection: &Selection) -> Option<String> {
    primary_clip_key(selection)
}

// Selecting one kind clears the others.

#[test]
fn a_scene_replaces_any_clip_selection_and_closes_the_drawer() {
    let with_clip = open_scene_editor(1.0);
    let next = act(&with_clip, Action::SelectScene { scene_id: 2.0 });
    assert_eq!(with_clip.editor_scene_id, Some(1.0));
    assert_eq!(next.scene_id, Some(2.0));
    assert_eq!(next.editor_scene_id, None);
    assert_eq!(primary(&next), None);
}

#[test]
fn a_clip_replaces_a_scene_selection() {
    let next = act(&select_scene(3.0), Action::SelectClip { source: Video, ref_id: 7.0 });
    assert_eq!(next.scene_id, None);
    assert_eq!(next.video_overlay_id, Some(7.0));
    assert_eq!(primary(&next).as_deref(), Some("video:7"));
}

#[test]
fn each_clip_family_clears_the_others() {
    let text = select_clip(Text, 1.0);
    assert_eq!([text.video_overlay_id, text.audio_id], [None; 2]);
    let audio = select_clip(Audio, 2.0);
    assert_eq!([audio.video_overlay_id, audio.overlay_id], [None; 2]);
}

#[test]
fn an_effect_selects_like_any_other_clip_family() {
    let next = select_clip(Effect, 6.0);
    assert_eq!(next.effect_id, Some(6.0));
    assert_eq!(primary(&next).as_deref(), Some("effect:6"));
    assert_eq!([next.video_overlay_id, next.overlay_id, next.audio_id], [None; 3]);
}

#[test]
fn selecting_a_clip_replaces_the_multi_select_set_rather_than_adding_to_it() {
    let many = toggle(&toggle(&none(), Video, 1.0), Audio, 2.0);
    assert_eq!(many.free_ids.len(), 2);
    let single = act(&many, Action::SelectClip { source: Text, ref_id: 9.0 });
    assert_eq!(single.free_ids, ["text:9"]);
}

#[test]
fn a_transition_selection_stands_alone() {
    let next = act(&select_clip(Video, 1.0), Action::SelectTransition { transition_id: 4.0 });
    assert_eq!(next.transition_id, Some(4.0));
    assert_eq!(primary(&next), None);
    assert_eq!(next.scene_id, None);
}

#[test]
fn a_scene_or_caption_cannot_be_a_single_click_primary() {
    assert!(apply(&none(), &Action::SelectClip { source: Scene, ref_id: 1.0 }).is_err());
    assert!(apply(&none(), &Action::SelectClip { source: ClipSource::Caption, ref_id: 1.0 }).is_err());
}

// Shift-click toggling.

#[test]
fn toggling_adds_a_clip_and_makes_it_primary() {
    let next = toggle(&none(), Video, 1.0);
    assert_eq!(next.free_ids, ["video:1"]);
    assert_eq!(next.video_overlay_id, Some(1.0));
}

#[test]
fn toggling_removes_a_clip_that_was_already_in_the_set() {
    let removed = toggle(&toggle(&none(), Video, 1.0), Video, 1.0);
    assert!(removed.free_ids.is_empty());
}

#[test]
fn toggling_accumulates_across_families() {
    let next = toggle(&toggle(&none(), Video, 1.0), Text, 2.0);
    let mut ids = next.free_ids.clone();
    ids.sort();
    assert_eq!(ids, ["text:2", "video:1"]);
}

#[test]
fn toggling_clears_the_scene_selection_and_the_drawer() {
    let next = toggle(&open_scene_editor(3.0), Video, 1.0);
    assert_eq!(next.scene_id, None);
    assert_eq!(next.editor_scene_id, None);
}

// What counts as selected.

#[test]
fn a_clip_is_selected_when_primary_or_in_the_set() {
    let primary = select_clip(Audio, 4.0);
    assert!(is_clip_selected(&primary, "audio:4"));
    assert!(!is_clip_selected(&primary, "audio:5"));
    let multi = toggle(&toggle(&none(), Video, 1.0), Text, 2.0);
    assert!(is_clip_selected(&multi, "video:1"));
    assert!(is_clip_selected(&multi, "text:2"));
}

#[test]
fn the_primary_key_follows_a_fixed_family_order() {
    for (source, key) in [(Video, "video:1"), (Text, "text:1"), (Audio, "audio:1")] {
        assert_eq!(primary(&select_clip(source, 1.0)).as_deref(), Some(key));
    }
}

#[test]
fn clip_keys_are_the_ids_the_timeline_already_uses() {
    assert_eq!(clip_key(Video, 3.0), "video:3");
}

// Clearing.

#[test]
fn empty_space_clears_everything() {
    let next = act(&toggle(&open_scene_editor(1.0), Video, 2.0), Action::Clear);
    assert!(is_empty(&next));
    assert!(next.free_ids.is_empty());
    assert_eq!(next.editor_scene_id, None);
}

#[test]
fn a_scene_a_clip_a_transition_and_a_multi_select_all_count_as_non_empty() {
    assert!(!is_empty(&select_scene(1.0)));
    assert!(!is_empty(&select_clip(Video, 1.0)));
    assert!(!is_empty(&act(&none(), Action::SelectTransition { transition_id: 1.0 })));
    assert!(!is_empty(&toggle(&none(), Scene, 1.0)));
}

// Immutability.

#[test]
fn a_transition_returns_a_new_selection_rather_than_mutating() {
    let before = select_clip(Video, 1.0);
    let after = toggle(&before, Text, 2.0);
    assert_eq!(before.overlay_id, None);
    assert_eq!(after.overlay_id, Some(2.0));
    assert!(!before.free_ids.contains(&"text:2".to_owned()));
}

// Equality.

#[test]
fn selecting_the_same_clip_twice_says_the_same_thing() {
    assert!(selections_equal(&select_clip(Video, 1.0), &select_clip(Video, 1.0)));
}

#[test]
fn a_different_clip_kind_or_scene_is_a_different_selection() {
    assert!(!selections_equal(&select_clip(Video, 1.0), &select_clip(Video, 2.0)));
    assert!(!selections_equal(&select_clip(Video, 1.0), &select_clip(Text, 1.0)));
    assert!(!selections_equal(&select_scene(1.0), &select_scene(2.0)));
}

#[test]
fn the_multi_select_set_is_compared_by_membership_not_order() {
    let a = toggle(&toggle(&none(), Video, 1.0), Text, 2.0);
    let b = Selection { free_ids: a.free_ids.iter().rev().cloned().collect(), ..a.clone() };
    assert_ne!(a.free_ids, b.free_ids);
    assert!(selections_equal(&a, &b));
    assert!(!selections_equal(&a, &toggle(&a, Audio, 3.0)));
}

#[test]
fn an_emptied_selection_equals_a_cleared_one() {
    assert!(selections_equal(&act(&select_clip(Video, 1.0), Action::Clear), &none()));
}

// Shared core scenario: a selection rule is applied.

#[test]
fn selecting_a_text_clip_while_a_video_clip_is_selected_follows_the_core_rule() {
    let next = act(&select_clip(Video, 1.0), Action::SelectClip { source: Text, ref_id: 2.0 });
    assert_eq!((next.video_overlay_id, next.overlay_id), (None, Some(2.0)));
    assert_eq!(next.free_ids, ["text:2"]);
}

#[test]
fn actions_and_selections_cross_the_boundary_as_the_web_writes_them() {
    let action = Action::from_value(&serde_json::json!({ "type": "toggleClip", "source": "video", "refId": 1 })).expect("decodes");
    let next = act(&none(), action);
    let json = next.to_value();
    assert_eq!(json["videoOverlayId"], 1.0);
    assert_eq!(json["freeIds"][0], "video:1");
    assert!(json.get("sceneId").is_none());
    assert_eq!(Selection::from_value(&json).expect("decodes"), next);
    assert!(Action::from_value(&serde_json::json!({ "type": "toggleClip", "source": "slide", "refId": 1 })).is_err());
}
