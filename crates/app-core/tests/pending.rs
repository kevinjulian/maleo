//! The delta spec's "Pending local commands rebase over accepted commands" scenarios.

use maleo_app_core::{Ledger, PendingQueue, RebaseError};
use maleo_editor_core::{EditScope, EditorCommand, EngineError, admit_command, admit_scope, execute};
use serde_json::{Value, json};

fn scope(ids: &[&str]) -> EditScope {
    let clips: Vec<Value> = ids.iter().map(|id| json!({ "id": id, "type": "text", "startSec": 0, "durationSec": 1, "track": 0 })).collect();
    admit_scope(&json!({ "doc": { "schemaVersion": 2, "clips": clips, "markers": [] }, "slides": [], "posts": [], "mediaAssets": [] }).to_string())
        .expect("admits")
}

fn command(value: Value) -> EditorCommand {
    admit_command(&value.to_string()).expect("admits")
}

fn move_to(id: &str, start: f64) -> EditorCommand {
    command(json!({ "type": "clip.move", "id": id, "patch": { "startSec": start } }))
}

fn insert(id: &str, start: f64) -> EditorCommand {
    command(json!({ "type": "clip.insert", "clip": { "id": id, "type": "text", "startSec": start, "durationSec": 1, "track": 0 } }))
}

fn remove(id: &str) -> EditorCommand {
    command(json!({ "type": "clip.remove", "id": id }))
}

/// Execute locally, enqueue and record, as a controller does for a user edit.
fn local(queue: &mut PendingQueue, ledger: &mut Ledger, current: &EditScope, id: &str, cmd: EditorCommand) -> EditScope {
    let executed = execute(current, &cmd).expect("executes");
    queue.enqueue(id, cmd.clone(), executed.inverse.clone());
    let after = executed.scope.clone();
    ledger.record(cmd, current, None, Some(executed)).expect("records");
    after
}

fn run_all(start: &EditScope, commands: &[EditorCommand]) -> EditScope {
    commands.iter().fold(start.clone(), |state, cmd| execute(&state, cmd).expect("executes").scope)
}

fn ids(queue: &PendingQueue) -> Vec<&str> {
    queue.items().iter().map(|item| item.id.as_str()).collect()
}

#[test]
fn remote_commands_arriving_while_local_edits_wait_land_under_them() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    let s2 = local(&mut queue, &mut ledger, &s1, "c2", insert("text:2", 1.0));
    let remote = insert("text:9", 7.0);

    let rebased = queue.rebase(&s2, std::slice::from_ref(&remote), &mut ledger).expect("rebases");

    assert!(rebased.dropped.is_empty());
    assert_eq!(rebased.scope, run_all(&s0, &[remote, move_to("text:1", 4.0), insert("text:2", 1.0)]));
    assert_eq!(ids(&queue), ["c1", "c2"]);
}

#[test]
fn a_pending_command_that_no_longer_applies_is_dropped_and_reported() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));

    let rebased = queue.rebase(&s1, &[remove("text:1")], &mut ledger).expect("rebases");

    assert_eq!(rebased.dropped.len(), 1);
    assert_eq!(rebased.dropped[0].id, "c1");
    assert_eq!(rebased.dropped[0].command_type, "clip.move");
    assert_eq!(rebased.dropped[0].reason, EngineError::ClipNotFound("text:1".into()));
    assert_eq!(rebased.scope, scope(&[]));
    assert!(queue.items().is_empty());
}

#[test]
fn the_server_accepting_a_pending_command_removes_only_that_command() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    let s2 = local(&mut queue, &mut ledger, &s1, "c2", move_to("text:1", 5.0));

    assert!(queue.ack("c1"));
    assert!(!queue.ack("c1"));
    assert_eq!(ids(&queue), ["c2"]);
    // Acknowledging touches no document: the controller's scope stays s2.
    assert_eq!(queue.rebase(&s2, &[], &mut ledger).expect("rebases").scope, s2);
}

#[test]
fn undo_after_a_remote_change_drops_the_step_and_leaves_the_document() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    queue.ack("c1");
    let rebased = queue.rebase(&s1, &[remove("text:1")], &mut ledger).expect("rebases");

    let refused = ledger.undo(&rebased.scope).expect_err("cannot be undone");

    assert_eq!(refused.reason, EngineError::ClipNotFound("text:1".into()));
    assert_eq!(ledger.depths(), (0, 0));
    assert_eq!(rebased.scope, scope(&[]));
}

#[test]
fn a_rebase_clears_redo() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    queue.ack("c1");
    let undone = ledger.undo(&s1).expect("undoes").expect("undone");
    assert!(ledger.can_redo());
    queue.rebase(&undone, &[insert("text:9", 2.0)], &mut ledger).expect("rebases");
    assert!(!ledger.can_redo());
}

#[test]
fn a_reply_that_only_accepts_keeps_redo() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    queue.resolve(&s1, &[], &["c1"], &[], &mut ledger).expect("resolves");
    let undone = ledger.undo(&s1).expect("undoes").expect("undone");
    queue.enqueue("u1", move_to("text:1", 0.0), move_to("text:1", 4.0));
    assert!(ledger.can_redo());

    let resolved = queue.resolve(&undone, &[], &["u1"], &[], &mut ledger).expect("resolves");

    assert_eq!(resolved.scope, undone);
    assert!(ledger.can_redo());
}

#[test]
fn a_rejected_command_clears_redo() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    queue.ack("c1");
    let undone = ledger.undo(&s1).expect("undoes").expect("undone");
    queue.enqueue("u1", move_to("text:1", 0.0), move_to("text:1", 4.0));
    assert!(ledger.can_redo());

    queue.resolve(&undone, &[], &[], &["u1"], &mut ledger).expect("resolves");

    assert!(!ledger.can_redo());
}

#[test]
fn a_delivered_command_that_fails_is_a_divergence_and_changes_nothing() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    let before = queue.clone();

    let error = queue.rebase(&s1, &[insert("text:9", 1.0), move_to("text:missing", 1.0)], &mut ledger).expect_err("diverged");

    assert_eq!(error, RebaseError::Delivered { index: 1, reason: EngineError::ClipNotFound("text:missing".into()) });
    assert_eq!(queue, before);
    assert!(ledger.can_undo());
}

#[test]
fn a_reply_with_accepted_rejected_and_delivered_resolves_in_one_call() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1", "text:2"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    let s2 = local(&mut queue, &mut ledger, &s1, "c2", move_to("text:2", 6.0));
    let s3 = local(&mut queue, &mut ledger, &s2, "c3", insert("text:3", 2.0));
    let remote = insert("text:9", 7.0);

    // The server delivered `remote`, accepted c1 and c3 after it, and rejected c2.
    let resolved = queue.resolve(&s3, std::slice::from_ref(&remote), &["c1", "c3"], &["c2"], &mut ledger).expect("resolves");

    assert!(resolved.dropped.is_empty());
    assert_eq!(resolved.scope, run_all(&s0, &[remote, move_to("text:1", 4.0), insert("text:3", 2.0)]));
    assert!(queue.items().is_empty());
}

#[test]
fn a_resolve_keeps_commands_the_server_has_not_answered() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    // Made while the request was in flight.
    let s2 = local(&mut queue, &mut ledger, &s1, "c2", insert("text:2", 1.0));

    let resolved = queue.resolve(&s2, &[], &["c1"], &[], &mut ledger).expect("resolves");

    assert_eq!(resolved.scope, s2);
    assert_eq!(ids(&queue), ["c2"]);
}

#[test]
fn a_pending_command_that_no_longer_applies_after_delivered_is_dropped() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));

    let resolved = queue.resolve(&s1, &[remove("text:1")], &[], &[], &mut ledger).expect("resolves");

    assert_eq!(resolved.dropped.len(), 1);
    assert_eq!(resolved.dropped[0].id, "c1");
    assert!(queue.items().is_empty());
}

#[test]
fn an_accepted_command_that_no_longer_applies_is_a_divergence_and_changes_nothing() {
    let (mut queue, mut ledger) = (PendingQueue::default(), Ledger::default());
    let s0 = scope(&["text:1"]);
    let s1 = local(&mut queue, &mut ledger, &s0, "c1", move_to("text:1", 4.0));
    let before = queue.clone();

    let error = queue.resolve(&s1, &[remove("text:1")], &["c1"], &[], &mut ledger).expect_err("diverged");

    assert_eq!(error, RebaseError::Accepted { id: "c1".into(), reason: EngineError::ClipNotFound("text:1".into()) });
    assert_eq!(queue, before);
}
