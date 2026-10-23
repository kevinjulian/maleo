//! Twins of `apps/web/src/models/chat/command-ledger.test.ts`, case for case.

use maleo_app_core::Ledger;
use maleo_editor_core::{EditScope, EditorCommand, admit_command, admit_scope, execute};
use serde_json::{Value, json};

fn scope_of(value: Value) -> EditScope {
    admit_scope(&value.to_string()).expect("admits")
}

fn clip(id: &str, start: f64) -> Value {
    json!({ "id": id, "type": "text", "startSec": start, "durationSec": 1, "track": 0 })
}

fn at(ids: &[&str], start: f64) -> EditScope {
    scope_of(json!({
        "doc": { "schemaVersion": 2, "clips": ids.iter().map(|id| clip(id, start)).collect::<Vec<_>>(), "markers": [] },
        "slides": [], "posts": [], "mediaAssets": []
    }))
}

fn scope(ids: &[&str]) -> EditScope {
    at(ids, 0.0)
}

fn command(value: Value) -> EditorCommand {
    admit_command(&value.to_string()).expect("admits")
}

fn insert(id: &str) -> EditorCommand {
    command(json!({ "type": "clip.insert", "clip": clip(id, 0.0) }))
}

fn remove(id: &str) -> EditorCommand {
    command(json!({ "type": "clip.remove", "id": id }))
}

fn move_to(id: &str, start: f64) -> EditorCommand {
    command(json!({ "type": "clip.move", "id": id, "patch": { "startSec": start } }))
}

fn replace(scope: &EditScope, label: Option<&str>) -> EditorCommand {
    EditorCommand::ScopeReplace { scope: scope.clone(), label: label.map(|label| Value::String(label.to_owned())) }
}

fn run(scope: &EditScope, command: &EditorCommand) -> EditScope {
    execute(scope, command).expect("executes").scope
}

/// Drive a ledger the way the hook does: execute, then record with the execution.
fn apply(ledger: &mut Ledger, before: &EditScope, cmd: EditorCommand) -> EditScope {
    let executed = execute(before, &cmd).expect("executes");
    let after = executed.scope.clone();
    ledger.record(cmd, before, None, Some(executed)).expect("records");
    after
}

fn undo(ledger: &mut Ledger, current: &EditScope) -> Option<EditScope> {
    ledger.undo(current).expect("undoes")
}

fn redo(ledger: &mut Ledger, current: &EditScope) -> Option<EditScope> {
    ledger.redo(current).expect("redoes")
}

fn starts(scope: &EditScope) -> Vec<f64> {
    scope.doc.clips.iter().map(|clip| clip.start_sec).collect()
}

#[test]
fn undo_inverts_the_last_command_and_redo_reapplies_it() {
    let mut ledger = Ledger::default();
    let s0 = scope(&[]);
    let s1 = apply(&mut ledger, &s0, insert("text:1"));
    assert!(ledger.can_undo() && !ledger.can_redo());
    let undone = undo(&mut ledger, &s1).expect("undone");
    assert_eq!(undone, s0);
    assert!(!ledger.can_undo() && ledger.can_redo());
    assert_eq!(redo(&mut ledger, &undone), Some(s1));
    assert!(!ledger.can_redo());
}

#[test]
fn a_new_command_clears_the_redo_stack() {
    let mut ledger = Ledger::default();
    let s0 = scope(&["text:1"]);
    let s1 = apply(&mut ledger, &s0, remove("text:1"));
    let back = undo(&mut ledger, &s1).expect("undone");
    assert!(ledger.can_redo());
    apply(&mut ledger, &back, insert("text:9"));
    assert!(!ledger.can_redo());
}

#[test]
fn undo_and_redo_across_a_multi_step_history_return_to_each_prior_state() {
    let mut ledger = Ledger::default();
    let s0 = scope(&[]);
    let s1 = apply(&mut ledger, &s0, insert("text:1"));
    let s2 = apply(&mut ledger, &s1, insert("text:2"));
    let s3 = apply(&mut ledger, &s2, insert("text:3"));
    assert_eq!(s3.doc.clips.iter().map(|clip| clip.id.as_str()).collect::<Vec<_>>(), ["text:1", "text:2", "text:3"]);
    let u1 = undo(&mut ledger, &s3).expect("undone");
    assert_eq!(u1, s2);
    let u2 = undo(&mut ledger, &u1).expect("undone");
    assert_eq!(u2, s1);
    assert_eq!(redo(&mut ledger, &u2), Some(s2));
}

#[test]
fn replace_scope_edits_invert_to_the_recorded_baseline() {
    let mut ledger = Ledger::default();
    let base = scope(&["text:1"]);
    let edited = scope(&["text:1", "text:2"]);
    ledger.record(replace(&edited, None), &base, None, None).expect("records");
    assert_eq!(undo(&mut ledger, &edited), Some(base));
}

#[test]
fn undo_and_redo_work_for_image_slides_and_text_posts_without_a_clips_document() {
    let mut ledger = Ledger::default();
    let s0 = scope(&[]);
    let slide = json!({ "key": "slide_t1", "id": 1, "cap": "Slide caption", "vis": "Hero shot", "img": false });
    let s1 = apply(&mut ledger, &s0, command(json!({ "type": "slide.insert", "slide": slide })));
    let post = json!({ "key": "post_t1", "id": 1, "body": "Post body", "img": false });
    let s2 = apply(&mut ledger, &s1, command(json!({ "type": "post.insert", "post": post })));
    assert!(s2.doc.clips.is_empty());
    assert_eq!((s2.slides.len(), s2.posts.len()), (1, 1));
    let without_post = undo(&mut ledger, &s2).expect("undone");
    assert_eq!(without_post, s1);
    let without_slide = undo(&mut ledger, &without_post).expect("undone");
    assert_eq!(without_slide, s0);
    let with_slide_again = redo(&mut ledger, &without_slide).expect("redone");
    assert_eq!(with_slide_again, s1);
    assert_eq!(redo(&mut ledger, &with_slide_again), Some(s2));
}

#[test]
fn a_clip_update_inverts_cleanly_when_recorded_against_the_before_it_targets() {
    let mut ledger = Ledger::default();
    let before = scope(&["scene:1784841068223"]);
    let cmd = command(json!({ "type": "clip.update", "id": "scene:1784841068223", "patch": { "durationSec": 2 } }));
    let after = run(&before, &cmd);
    ledger.record(cmd, &before, None, None).expect("records");
    assert_eq!(undo(&mut ledger, &after), Some(before));
}

#[test]
fn recording_a_clip_update_against_a_stale_before_missing_the_clip_fails_and_keeps_history() {
    let mut ledger = Ledger::default();
    let cmd = command(json!({ "type": "clip.update", "id": "scene:1784841068223", "patch": { "durationSec": 2 } }));
    assert!(ledger.record(cmd, &scope(&[]), None, None).is_err());
    assert_eq!(ledger.depths(), (0, 0));
}

#[test]
fn undo_on_empty_history_is_a_no_op() {
    let mut ledger = Ledger::default();
    assert_eq!(undo(&mut ledger, &scope(&[])), None);
    assert_eq!(redo(&mut ledger, &scope(&[])), None);
}

#[test]
fn history_is_capped_at_the_limit() {
    let mut ledger = Ledger::new(3);
    let mut s = scope(&[]);
    for i in 0..10 {
        s = apply(&mut ledger, &s, insert(&format!("text:{i}")));
    }
    assert_eq!(ledger.depths().0, 3);
}

// A gesture collapses into one undo step.

#[test]
fn sixty_frames_of_one_drag_leave_one_entry_and_undo_returns_to_the_start() {
    let mut ledger = Ledger::default();
    let mut current = at(&["text:1"], 0.0);
    for frame in 1..=60 {
        let cmd = move_to("text:1", f64::from(frame));
        let next = run(&current, &cmd);
        ledger.record(cmd, &current, Some("drag-1"), None).expect("records");
        current = next;
    }
    assert_eq!(ledger.depths().0, 1);
    assert_eq!(starts(&current), [60.0]);
    assert_eq!(starts(&undo(&mut ledger, &current).expect("undone")), [0.0]);
}

fn three_clip_gesture(ledger: &mut Ledger, gesture: &str) -> EditScope {
    let mut current = at(&["text:1", "text:2", "text:3"], 0.0);
    for id in ["text:1", "text:2", "text:3"] {
        let cmd = move_to(id, 9.0);
        let next = run(&current, &cmd);
        ledger.record(cmd, &current, Some(gesture), None).expect("records");
        current = next;
    }
    current
}

#[test]
fn a_gesture_that_moves_three_clips_undoes_all_three() {
    let mut ledger = Ledger::default();
    let current = three_clip_gesture(&mut ledger, "reorder-1");
    assert_eq!(ledger.depths().0, 1);
    assert_eq!(starts(&current), [9.0, 9.0, 9.0]);
    assert_eq!(starts(&undo(&mut ledger, &current).expect("undone")), [0.0, 0.0, 0.0]);
}

#[test]
fn redoing_a_three_clip_gesture_restores_all_three() {
    let mut ledger = Ledger::default();
    let current = three_clip_gesture(&mut ledger, "reorder-2");
    let undone = undo(&mut ledger, &current).expect("undone");
    assert_eq!(starts(&undone), [0.0, 0.0, 0.0]);
    assert_eq!(starts(&redo(&mut ledger, &undone).expect("redone")), [9.0, 9.0, 9.0]);
}

#[test]
fn without_a_gesture_the_same_frames_are_sixty_entries() {
    let mut ledger = Ledger::default();
    let mut current = at(&["text:1"], 0.0);
    for frame in 1..=60 {
        let cmd = move_to("text:1", f64::from(frame));
        let next = run(&current, &cmd);
        ledger.record(cmd, &current, None, None).expect("records");
        current = next;
    }
    assert_eq!(ledger.depths().0, 60);
}

#[test]
fn a_drag_does_not_swallow_the_edit_before_it() {
    let mut ledger = Ledger::default();
    let s0 = scope(&[]);
    let s1 = apply(&mut ledger, &s0, insert("text:1"));
    let mut current = s1.clone();
    for frame in [1.0, 2.0, 3.0] {
        let cmd = move_to("text:1", frame);
        let next = run(&current, &cmd);
        ledger.record(cmd, &current, Some("drag-2"), None).expect("records");
        current = next;
    }
    assert_eq!(ledger.depths().0, 2);
    assert_eq!(undo(&mut ledger, &current), Some(s1.clone()));
    assert_eq!(undo(&mut ledger, &s1), Some(s0));
}

#[test]
fn two_drags_are_two_steps() {
    let mut ledger = Ledger::default();
    let mut current = at(&["text:1"], 0.0);
    for (gesture, offset) in [("drag-a", 0.0), ("drag-b", 10.0)] {
        for frame in [1.0, 2.0] {
            let cmd = move_to("text:1", frame + offset);
            let next = run(&current, &cmd);
            ledger.record(cmd, &current, Some(gesture), None).expect("records");
            current = next;
        }
    }
    assert_eq!(ledger.depths().0, 2);
}

#[test]
fn a_gesture_still_clears_redo_like_any_other_edit() {
    let mut ledger = Ledger::default();
    let s0 = scope(&["text:1"]);
    let s1 = apply(&mut ledger, &s0, remove("text:1"));
    undo(&mut ledger, &s1);
    assert!(ledger.can_redo());
    ledger.record(insert("text:2"), &s0, Some("drag-3"), None).expect("records");
    assert!(!ledger.can_redo());
}

// latestStep

#[test]
fn latest_step_names_the_step_the_next_undo_reverses() {
    let mut ledger = Ledger::default();
    assert_eq!(ledger.latest_step(), None);
    let base = scope(&[]);
    let with_slide = scope_of(json!({
        "doc": { "schemaVersion": 2, "clips": [], "markers": [] },
        "slides": [{ "key": "k1", "id": 1, "cap": "a", "vis": "", "img": false }], "posts": [], "mediaAssets": []
    }));
    let first = replace(&with_slide, Some("agent.slides"));
    let first_step = ledger.record(first.clone(), &base, None, None).expect("records");
    assert!(ledger.is_latest(&first_step));
    let second_step = ledger.record(replace(&base, Some("user.edit")), &run(&base, &first), None, None).expect("records");
    assert!(ledger.is_latest(&second_step));
    undo(&mut ledger, &base);
    assert!(ledger.is_latest(&first_step));
}

#[test]
fn two_equal_commands_recorded_as_separate_steps_are_told_apart() {
    let mut ledger = Ledger::default();
    let s0 = scope(&["text:1"]);
    let earlier = ledger.record(move_to("text:1", 3.0), &s0, None, None).expect("records");
    let s1 = run(&s0, &move_to("text:1", 3.0));
    let later = ledger.record(move_to("text:1", 3.0), &s1, None, None).expect("records");
    assert_ne!(earlier, later);
    assert!(ledger.is_latest(&later));
    undo(&mut ledger, &s1);
    assert!(ledger.is_latest(&earlier));
}

#[test]
fn a_gesture_that_collapses_into_the_top_entry_gets_a_new_step_id() {
    let mut ledger = Ledger::default();
    let s0 = scope(&["text:1"]);
    let first = ledger.record(move_to("text:1", 1.0), &s0, Some("drag"), None).expect("records");
    let collapsed = ledger.record(move_to("text:1", 2.0), &run(&s0, &move_to("text:1", 1.0)), Some("drag"), None).expect("records");
    assert_ne!(collapsed, first);
    assert!(ledger.is_latest(&collapsed));
}

#[test]
fn a_settled_whole_plan_result_applies_as_one_step_and_undoes_to_the_prior_state() {
    let mut ledger = Ledger::default();
    let s0 = scope_of(json!({
        "doc": { "schemaVersion": 2, "clips": [clip("text:1", 0.0)], "markers": [] },
        "slides": [{ "key": "slide_a", "id": 1, "cap": "Before", "vis": "Wide", "img": false }],
        "posts": [{ "key": "post_a", "id": 1, "body": "Before", "img": false }],
        "mediaAssets": []
    }));
    let plan = scope_of(json!({
        "doc": { "schemaVersion": 2, "clips": [clip("text:1", 0.0), clip("text:2", 0.0)], "markers": [] },
        "slides": [
            { "key": "slide_a", "id": 1, "cap": "After", "vis": "Wide", "img": false, "name": "Added by the plan" },
            { "key": "slide_b", "id": 2, "cap": "New", "vis": "Close", "img": false }
        ],
        "posts": [{ "key": "post_a", "id": 1, "body": "After", "img": false }],
        "mediaAssets": []
    }));
    let s1 = apply(&mut ledger, &s0, replace(&plan, Some("agent.plan")));
    assert_eq!(s1, plan);
    let undone = undo(&mut ledger, &s1).expect("undone");
    assert_eq!(undone, s0);
    assert!(!ledger.can_undo());
    assert_eq!(redo(&mut ledger, &undone), Some(plan));
}

// Shared core scenario: undo history crosses clients.

#[test]
fn two_ledgers_given_the_same_commands_hold_the_same_steps() {
    let drive = || {
        let mut ledger = Ledger::default();
        let s0 = scope(&[]);
        let s1 = apply(&mut ledger, &s0, insert("text:1"));
        let s2 = apply(&mut ledger, &s1, insert("text:2"));
        let u1 = undo(&mut ledger, &s2).expect("undone");
        let u2 = undo(&mut ledger, &u1).expect("undone");
        redo(&mut ledger, &u2);
        ledger.step_ids().0.iter().chain(ledger.step_ids().1.iter()).map(|id| (*id).to_owned()).collect::<Vec<_>>()
    };
    assert_eq!(drive(), ["step-1", "step-2"]);
    assert_eq!(drive(), drive());
}
