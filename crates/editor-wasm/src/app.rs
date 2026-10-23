//! The boundary for `maleo-app-core` (OpenSpec `p1-app-core` D2): undo
//! ledgers, pending queues and selection rules.
//!
//! A ledger and a queue each have their own handle, so a document handle can
//! be reopened under them. A call that touches the document names the
//! document handle and acts on the scope it holds; an undo or redo answers
//! with a delta like `Documents::execute_delta`, so the document never
//! crosses the boundary per edit.

use maleo_app_core::selection::{self, Action, Selection};
use maleo_app_core::{Ledger, PendingQueue, RebaseError};
use maleo_editor_core::command::admit_command_value;
use maleo_editor_core::json::to_js_string;
use maleo_editor_core::{EditScope, EngineError, Executed, admit_scope};
use serde_json::{Value, json};

use crate::{Documents, error_json, invalid};

fn parse(json: &str) -> Result<Value, String> {
    serde_json::from_str(json).map_err(|error| invalid(error.to_string()))
}

fn command_at(value: &mut Value, key: &str) -> Result<maleo_editor_core::EditorCommand, String> {
    admit_command_value(value[key].take()).map_err(|error| error_json(&error))
}

fn scope_at(value: &Value, key: &str) -> Result<EditScope, String> {
    admit_scope(&value[key].to_string()).map_err(|error| error_json(&error))
}

fn gesture(value: &Value) -> Option<&str> {
    value.get("gesture").and_then(Value::as_str)
}

/// `{"kind", "message", …extra}`: an engine refusal with more context.
fn refusal(kind: &str, reason: &EngineError, extra: Value) -> String {
    let mut out = json!({ "kind": kind, "message": reason.to_string(), "reason": serde_json::from_str::<Value>(&error_json(reason)).ok() });
    if let (Some(out), Some(extra)) = (out.as_object_mut(), extra.as_object()) {
        out.extend(extra.clone());
    }
    out.to_string()
}

fn unknown(what: &str, handle: u32) -> String {
    json!({ "kind": "UnknownHandle", "message": format!("no open {what} with handle {handle}") }).to_string()
}

/// Move the document to `next` and describe the move as a delta.
fn land(documents: &mut Documents, doc: u32, next: EditScope) -> Result<String, String> {
    let delta = maleo_editor_core::delta::delta(documents.scope(doc)?, &next).map_err(invalid)?;
    documents.replace(doc, next)?;
    Ok(delta)
}

#[derive(Default)]
pub struct AppState {
    next: u32,
    // ponytail: linear lookup; a page holds a handful of ledgers and queues.
    // A `Vec` rather than a map keeps another map instantiation out of the module.
    ledgers: Vec<(u32, Ledger)>,
    queues: Vec<(u32, PendingQueue)>,
}

fn find<T>(items: &mut [(u32, T)], handle: u32) -> Option<&mut T> {
    items.iter_mut().find(|(key, _)| *key == handle).map(|(_, item)| item)
}

fn remove<T>(items: &mut Vec<(u32, T)>, handle: u32) -> Option<T> {
    let index = items.iter().position(|(key, _)| *key == handle)?;
    Some(items.swap_remove(index).1)
}

impl AppState {
    fn handle(&mut self) -> u32 {
        self.next += 1;
        self.next
    }

    fn ledger(&mut self, handle: u32) -> Result<&mut Ledger, String> {
        find(&mut self.ledgers, handle).ok_or_else(|| unknown("ledger", handle))
    }

    fn queue(&mut self, handle: u32) -> Result<&mut PendingQueue, String> {
        find(&mut self.queues, handle).ok_or_else(|| unknown("pending queue", handle))
    }

    pub fn ledger_open(&mut self, limit: u32) -> u32 {
        let handle = self.handle();
        self.ledgers.push((handle, Ledger::new(limit as usize)));
        handle
    }

    pub fn ledger_close(&mut self, handle: u32) -> Result<(), String> {
        remove(&mut self.ledgers, handle).map(|_| ()).ok_or_else(|| unknown("ledger", handle))
    }

    /// Record the document's last execution: `{"gesture"?}` in, the step id out.
    pub fn ledger_record(&mut self, documents: &mut Documents, ledger: u32, doc: u32, json: &str) -> Result<String, String> {
        let options = parse(json)?;
        let ledger = self.ledger(ledger)?;
        let (last, after) = documents.take_last(doc)?;
        let executed = Executed { scope: after, inverse: last.inverse };
        ledger.record(last.command, &last.before, gesture(&options), Some(executed)).map_err(|error| error_json(&error))
    }

    /// Record a change the host applied itself:
    /// `{"command", "inverse", "before", "after", "gesture"?}` in, the step id out.
    pub fn ledger_record_applied(&mut self, ledger: u32, json: &str) -> Result<String, String> {
        let mut input = parse(json)?;
        let before = scope_at(&input, "before")?;
        let after = scope_at(&input, "after")?;
        let command = command_at(&mut input, "command")?;
        let inverse = command_at(&mut input, "inverse")?;
        let executed = Executed { scope: after, inverse };
        self.ledger(ledger)?.record(command, &before, gesture(&input), Some(executed)).map_err(|error| error_json(&error))
    }

    /// `null` with nothing to undo, else `{"delta"}`. A refused inverse drops
    /// the step: `{"kind": "UndoRefused", "step", "reason", …}`.
    pub fn ledger_undo(&mut self, documents: &mut Documents, ledger: u32, doc: u32) -> Result<String, String> {
        let current = documents.scope(doc)?;
        match self.ledger(ledger)?.undo(current) {
            Ok(None) => Ok("null".to_owned()),
            Ok(Some(next)) => land(documents, doc, next).map(|delta| format!("{{\"delta\":{delta}}}")),
            Err(refused) => Err(refusal("UndoRefused", &refused.reason, json!({ "step": refused.step }))),
        }
    }

    /// `null` with nothing to redo, else `{"delta"}`; a refusal keeps both stacks.
    pub fn ledger_redo(&mut self, documents: &mut Documents, ledger: u32, doc: u32) -> Result<String, String> {
        let current = documents.scope(doc)?;
        match self.ledger(ledger)?.redo(current).map_err(|error| error_json(&error))? {
            None => Ok("null".to_owned()),
            Some(next) => land(documents, doc, next).map(|delta| format!("{{\"delta\":{delta}}}")),
        }
    }

    /// `{"undo": [ids…], "redo": [ids…]}`, oldest first.
    pub fn ledger_state(&mut self, ledger: u32) -> Result<String, String> {
        let (undo, redo) = self.ledger(ledger)?.step_ids();
        Ok(json!({ "undo": undo, "redo": redo }).to_string())
    }

    pub fn pending_open(&mut self) -> u32 {
        let handle = self.handle();
        self.queues.push((handle, PendingQueue::default()));
        handle
    }

    pub fn pending_close(&mut self, handle: u32) -> Result<(), String> {
        remove(&mut self.queues, handle).map(|_| ()).ok_or_else(|| unknown("pending queue", handle))
    }

    /// `{"id", "command", "inverse"}`.
    pub fn pending_enqueue(&mut self, queue: u32, json: &str) -> Result<String, String> {
        let mut input = parse(json)?;
        let id = input.get("id").and_then(Value::as_str).ok_or_else(|| invalid("a pending command needs a string `id`"))?.to_owned();
        let command = command_at(&mut input, "command")?;
        let inverse = command_at(&mut input, "inverse")?;
        self.queue(queue)?.enqueue(id, command, inverse);
        Ok(String::new())
    }

    /// The client command id in; `true` when it was pending.
    pub fn pending_ack(&mut self, queue: u32, id: &str) -> Result<String, String> {
        Ok(self.queue(queue)?.ack(id).to_string())
    }

    /// `{"delivered": [commands…]}` in; `{"delta", "dropped": [{"id", "type", "kind", "message"}]}` out.
    pub fn pending_rebase(&mut self, documents: &mut Documents, queue: u32, ledger: u32, doc: u32, json: &str) -> Result<String, String> {
        let mut input = parse(json)?;
        let delivered = match input["delivered"].take() {
            Value::Array(commands) => commands.into_iter().map(admit_command_value).collect::<Result<Vec<_>, _>>().map_err(|error| error_json(&error))?,
            _ => return Err(invalid("`delivered` is not an array")),
        };
        let scope = documents.scope(doc)?;
        let held = find(&mut self.ledgers, ledger).ok_or_else(|| unknown("ledger", ledger))?;
        let pending = find(&mut self.queues, queue).ok_or_else(|| unknown("pending queue", queue))?;
        let rebased = pending.rebase(scope, &delivered, held).map_err(|error| match error {
            RebaseError::Unwind { id, reason } => refusal("RebaseUnwind", &reason, json!({ "id": id })),
            RebaseError::Delivered { index, reason } => refusal("RebaseDelivered", &reason, json!({ "index": index })),
        })?;
        let dropped: Vec<Value> = rebased
            .dropped
            .iter()
            .map(|dropped| {
                let reason: Value = serde_json::from_str(&error_json(&dropped.reason)).unwrap_or(Value::Null);
                json!({ "id": dropped.id, "type": dropped.command_type, "kind": reason["kind"], "message": reason["message"] })
            })
            .collect();
        let delta = land(documents, doc, rebased.scope)?;
        Ok(format!("{{\"delta\":{delta},\"dropped\":{}}}", Value::Array(dropped)))
    }

    /// `[{"id", "type"}…]` in queue order.
    pub fn pending_state(&mut self, queue: u32) -> Result<String, String> {
        let items: Vec<Value> =
            self.queue(queue)?.items().iter().map(|item| json!({ "id": item.id, "type": maleo_app_core::ledger::command_type(&item.command) })).collect();
        Ok(Value::Array(items).to_string())
    }
}

/// `{"selection", "action"}` in; the next selection out.
pub fn selection_apply(json: &str) -> Result<String, String> {
    let input = parse(json)?;
    let current = Selection::from_value(&input["selection"]).map_err(invalid)?;
    let action = Action::from_value(&input["action"]).map_err(invalid)?;
    let next = selection::apply(&current, &action).map_err(invalid)?;
    to_js_string(&next.to_value()).map_err(invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = r#"{"mediaAssets":[],"slides":[],"posts":[],"doc":{"schemaVersion":2,"markers":[],"clips":[{"id":"text:1","type":"text","startSec":1,"durationSec":2,"track":0}]}}"#;
    const MOVE: &str = r#"{"type":"clip.move","id":"text:1","patch":{"startSec":4}}"#;

    fn kind(error: &str) -> String {
        serde_json::from_str::<Value>(error).expect("error is JSON")["kind"].as_str().unwrap_or_default().to_owned()
    }

    #[test]
    fn a_ledger_records_the_documents_last_execution_and_undoes_it_there() {
        let (mut app, mut documents) = (AppState::default(), Documents::default());
        let doc = documents.open(SCOPE).expect("opens");
        let ledger = app.ledger_open(60);
        assert_eq!(kind(&app.ledger_record(&mut documents, ledger, doc, "{}").expect_err("nothing executed")), "InvalidInput");

        documents.execute_delta(doc, MOVE).expect("moves");
        let step = app.ledger_record(&mut documents, ledger, doc, "{}").expect("records");
        assert_eq!(step, "step-1");
        assert_eq!(app.ledger_state(ledger).expect("state"), r#"{"undo":["step-1"],"redo":[]}"#);

        let undone = app.ledger_undo(&mut documents, ledger, doc).expect("undoes");
        assert!(undone.starts_with(r#"{"delta":{"doc":{"clips":[{"id":"text:1""#), "{undone}");
        assert!(undone.contains(r#""startSec":1"#), "{undone}");
        assert!(!undone.contains("mediaAssets"), "unchanged media keeps its identity: {undone}");
        assert!(documents.read(doc).expect("reads").contains(r#""startSec":1"#));

        assert!(app.ledger_redo(&mut documents, ledger, doc).expect("redoes").contains(r#""startSec":4"#));
        assert_eq!(app.ledger_redo(&mut documents, ledger, doc).expect("nothing to redo"), "null");
        app.ledger_close(ledger).expect("closes");
        assert_eq!(kind(&app.ledger_state(ledger).expect_err("closed")), "UnknownHandle");
    }

    #[test]
    fn a_ledger_outlives_a_reopened_document() {
        let (mut app, mut documents) = (AppState::default(), Documents::default());
        let ledger = app.ledger_open(60);
        let first = documents.open(SCOPE).expect("opens");
        documents.execute(first, MOVE).expect("moves");
        app.ledger_record(&mut documents, ledger, first, "{}").expect("records");
        let moved = documents.read(first).expect("reads");
        documents.close(first).expect("closes");

        let second = documents.open(&moved).expect("reopens");
        app.ledger_undo(&mut documents, ledger, second).expect("undoes");
        assert!(documents.read(second).expect("reads").contains(r#""startSec":1"#));
    }

    #[test]
    fn an_applied_change_is_recorded_from_both_scopes() {
        let (mut app, mut documents) = (AppState::default(), Documents::default());
        let ledger = app.ledger_open(60);
        let after = SCOPE.replace(r#""slides":[]"#, r#""slides":[{"key":"k","id":1}]"#);
        let input = format!(
            r#"{{"command":{{"type":"scope.replace","scope":{after}}},"inverse":{{"type":"scope.replace","scope":{SCOPE}}},"before":{SCOPE},"after":{after}}}"#
        );
        app.ledger_record_applied(ledger, &input).expect("records");
        let doc = documents.open(&after).expect("opens");
        app.ledger_undo(&mut documents, ledger, doc).expect("undoes");
        assert!(documents.read(doc).expect("reads").contains(r#""slides":[]"#));
    }

    #[test]
    fn an_undo_whose_target_is_gone_is_refused_and_dropped() {
        let (mut app, mut documents) = (AppState::default(), Documents::default());
        let doc = documents.open(SCOPE).expect("opens");
        let (ledger, queue) = (app.ledger_open(60), app.pending_open());
        let inverse = documents.execute(doc, MOVE).expect("moves");
        app.ledger_record(&mut documents, ledger, doc, "{}").expect("records");
        app.pending_enqueue(queue, &format!(r#"{{"id":"c1","command":{MOVE},"inverse":{inverse}}}"#)).expect("enqueues");
        assert_eq!(app.pending_state(queue).expect("state"), r#"[{"id":"c1","type":"clip.move"}]"#);

        let rebased = app.pending_rebase(&mut documents, queue, ledger, doc, r#"{"delivered":[{"type":"clip.remove","id":"text:1"}]}"#).expect("rebases");
        assert!(rebased.contains(r#""dropped":[{"id":"c1","type":"clip.move","kind":"ClipNotFound""#), "{rebased}");
        assert!(documents.read(doc).expect("reads").contains(r#""clips":[]"#));
        assert_eq!(app.pending_state(queue).expect("state"), "[]");

        let refused = app.ledger_undo(&mut documents, ledger, doc).expect_err("cannot be undone");
        assert_eq!(kind(&refused), "UndoRefused");
        assert!(refused.contains(r#""step":"step-1""#), "{refused}");
        assert_eq!(app.ledger_state(ledger).expect("state"), r#"{"undo":[],"redo":[]}"#);
    }

    #[test]
    fn a_failing_delivered_command_leaves_document_and_queue() {
        let (mut app, mut documents) = (AppState::default(), Documents::default());
        let doc = documents.open(SCOPE).expect("opens");
        let (ledger, queue) = (app.ledger_open(60), app.pending_open());
        let inverse = documents.execute(doc, MOVE).expect("moves");
        app.pending_enqueue(queue, &format!(r#"{{"id":"c1","command":{MOVE},"inverse":{inverse}}}"#)).expect("enqueues");
        let before = documents.read(doc).expect("reads");

        let error =
            app.pending_rebase(&mut documents, queue, ledger, doc, r#"{"delivered":[{"type":"clip.move","id":"gone","patch":{}}]}"#).expect_err("diverged");
        assert_eq!(kind(&error), "RebaseDelivered");
        assert_eq!(documents.read(doc).expect("reads"), before);
        assert_eq!(app.pending_ack(queue, "c1").expect("acks"), "true");
        assert_eq!(app.pending_ack(queue, "c1").expect("acks"), "false");
    }

    #[test]
    fn a_selection_action_crosses_as_json() {
        let empty = r#"{"overlayId":null,"infographicId":null,"audioId":null,"videoOverlayId":null,"effectId":null,"transitionId":null,"freeIds":[]}"#;
        let next = selection_apply(&format!(r#"{{"selection":{empty},"action":{{"type":"selectClip","source":"video","refId":7}}}}"#)).expect("applies");
        assert_eq!(
            next,
            r#"{"overlayId":null,"infographicId":null,"audioId":null,"videoOverlayId":7,"effectId":null,"transitionId":null,"freeIds":["video:7"]}"#
        );
        assert_eq!(kind(&selection_apply(&format!(r#"{{"selection":{empty},"action":{{"type":"jump"}}}}"#)).expect_err("unknown")), "InvalidInput");
    }
}
