//! Undo and redo bookkeeping, ported from `apps/web/src/models/chat/command-ledger.ts`.
//!
//! The ledger owns the two stacks and their invariants: undo inverts the last
//! command, redo re-applies it, and any newly recorded command clears redo.
//! It never holds the document; each call takes the scope it acts on.

use std::collections::BTreeSet;
use std::sync::Arc;

use maleo_editor_core::{EditScope, EditorCommand, EngineError, EngineResult, Executed, execute};
use serde_json::Value;

/// The default history depth, as the web editor has always used.
pub const DEFAULT_LIMIT: usize = 60;

#[derive(Clone, Debug)]
struct Entry {
    /// This step's own identity. Two steps recording equal command data are
    /// still two steps, so "is this still the latest" is answered by id.
    id: String,
    command: EditorCommand,
    inverse: EditorCommand,
    /// The scope this entry undoes back to, so a gesture that records again
    /// re-inverts against where the gesture started.
    before: EditScope,
    gesture: Option<String>,
    /// Only assets changed by this action belong to its undo and redo.
    media_ids: BTreeSet<String>,
}

/// An undo step whose inverse no longer applies. The step has left the stack.
#[derive(Clone, Debug, PartialEq)]
pub struct UndoRefused {
    pub step: String,
    pub reason: EngineError,
}

#[derive(Clone, Debug)]
pub struct Ledger {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    steps: u64,
    limit: usize,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new(DEFAULT_LIMIT)
    }
}

/// `commandLabel`: a batch or replace keeps its own label.
pub fn command_label(command: &EditorCommand) -> String {
    let own = |label: &Option<Value>, fallback: &str| label.as_ref().and_then(Value::as_str).unwrap_or(fallback).to_owned();
    match command {
        EditorCommand::Batch { label, .. } => own(label, "batch"),
        EditorCommand::ScopeReplace { label, .. } => own(label, "edit"),
        other => command_type(other),
    }
}

/// The command's wire `type`.
pub fn command_type(command: &EditorCommand) -> String {
    command.kind().to_owned()
}

/// An asset's identity as a map key; an asset without an id keys as "".
fn media_key(asset: &Value) -> String {
    asset.get("id").map(Value::to_string).unwrap_or_default()
}

fn changed_media(before: &EditScope, after: &EditScope) -> BTreeSet<String> {
    let find = |scope: &EditScope, key: &str| scope.media_assets.iter().find(|asset| media_key(asset) == key).cloned();
    before
        .media_assets
        .iter()
        .chain(after.media_assets.iter())
        .map(media_key)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|key| find(before, key) != find(after, key))
        .collect()
}

/// Background staging is separate from document edits, so retain untouched assets.
fn retain_unrelated_media(current: &EditScope, result: EditScope, ids: &BTreeSet<String>) -> EditScope {
    let live = |key: &str| current.media_assets.iter().find(|asset| media_key(asset) == key);
    let restored_ids: BTreeSet<String> = result.media_assets.iter().map(media_key).collect();
    let restored = result.media_assets.iter().filter_map(|asset| {
        let key = media_key(asset);
        if ids.contains(&key) { Some(asset.clone()) } else { live(&key).cloned() }
    });
    let kept = current.media_assets.iter().filter(|asset| {
        let key = media_key(asset);
        !ids.contains(&key) && !restored_ids.contains(&key)
    });
    let media_assets: Vec<Value> = kept.cloned().chain(restored).collect();
    // Keep a shared part's identity when its value did not change, so a host
    // rebuilding from the delta keeps its own object too.
    let media_assets =
        [&current.media_assets, &result.media_assets].into_iter().find(|shared| ***shared == media_assets).map_or_else(|| Arc::new(media_assets), Arc::clone);
    EditScope { media_assets, ..result }
}

impl Ledger {
    pub fn new(limit: usize) -> Self {
        Self { undo: Vec::new(), redo: Vec::new(), steps: 0, limit }
    }

    fn next_id(&mut self) -> String {
        self.steps += 1;
        format!("step-{}", self.steps)
    }

    /// Record a command already applied to `before` and clear redo. Pass
    /// `executed` when the caller already ran it, so it does not run twice.
    ///
    /// `gesture` makes a continuous interaction one undo step: when it matches
    /// the top entry, that entry is replaced by the two scopes that bracket the
    /// gesture, so undo and redo restore every clip the gesture touched.
    pub fn record(&mut self, command: EditorCommand, before: &EditScope, gesture: Option<&str>, executed: Option<Executed>) -> EngineResult<String> {
        let executed = match executed {
            Some(executed) => executed,
            None => execute(before, &command)?,
        };
        let top = self.undo.last().filter(|top| gesture.is_some() && top.gesture.as_deref() == gesture).cloned();
        let id = self.next_id();
        let entry = match top {
            Some(top) => {
                let label = Some(Value::String(command_label(&command)));
                self.undo.pop();
                Entry {
                    id: id.clone(),
                    media_ids: changed_media(&top.before, &executed.scope),
                    command: EditorCommand::ScopeReplace { scope: executed.scope, label: label.clone() },
                    inverse: EditorCommand::ScopeReplace { scope: top.before.clone(), label },
                    before: top.before,
                    gesture: top.gesture,
                }
            }
            None => Entry {
                id: id.clone(),
                media_ids: changed_media(before, &executed.scope),
                command,
                inverse: executed.inverse,
                before: before.clone(),
                gesture: gesture.map(str::to_owned),
            },
        };
        self.undo.push(entry);
        if self.undo.len() > self.limit {
            let excess = self.undo.len() - self.limit;
            self.undo.drain(..excess);
        }
        self.redo.clear();
        Ok(id)
    }

    /// Execute the most recent step's inverse against `current` as a new command.
    /// `Ok(None)` when there is nothing to undo. An inverse that no longer
    /// applies (a remote change removed its target) drops the step.
    pub fn undo(&mut self, current: &EditScope) -> Result<Option<EditScope>, UndoRefused> {
        let Some(entry) = self.undo.pop() else {
            return Ok(None);
        };
        match execute(current, &entry.inverse) {
            Ok(undone) => {
                let scope = retain_unrelated_media(current, undone.scope, &entry.media_ids);
                self.redo.push(entry);
                Ok(Some(scope))
            }
            Err(reason) => Err(UndoRefused { step: entry.id, reason }),
        }
    }

    /// Re-apply the most recently undone command against `current`. A refused
    /// command leaves both stacks as they were.
    pub fn redo(&mut self, current: &EditScope) -> EngineResult<Option<EditScope>> {
        let Some(entry) = self.redo.last() else {
            return Ok(None);
        };
        let redone = execute(current, &entry.command)?;
        let scope = retain_unrelated_media(current, redone.scope, &entry.media_ids);
        if let Some(entry) = self.redo.pop() {
            self.undo.push(entry);
        }
        Ok(Some(scope))
    }

    /// A rebase changed the document under every redo step.
    pub fn clear_redo(&mut self) {
        self.redo.clear();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// The id of the step the next undo would reverse.
    pub fn latest_step(&self) -> Option<&str> {
        self.undo.last().map(|entry| entry.id.as_str())
    }

    pub fn is_latest(&self, step: &str) -> bool {
        self.latest_step() == Some(step)
    }

    /// Undo step ids, oldest first, then redo step ids, oldest first.
    pub fn step_ids(&self) -> (Vec<&str>, Vec<&str>) {
        fn ids(stack: &[Entry]) -> Vec<&str> {
            stack.iter().map(|entry| entry.id.as_str()).collect()
        }
        (ids(&self.undo), ids(&self.redo))
    }

    pub fn depths(&self) -> (usize, usize) {
        (self.undo.len(), self.redo.len())
    }
}
