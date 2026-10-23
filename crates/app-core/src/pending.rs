//! Local commands the server has not accepted yet, rebased over the commands
//! it delivers (`p1-app-core` D3). Pure state: the controller owns transport.

use maleo_editor_core::{EditScope, EditorCommand, EngineError, execute};

use crate::ledger::{Ledger, command_type};

#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    /// The client command identity the server acknowledges by.
    pub id: String,
    pub command: EditorCommand,
    /// The inverse against the document the command last applied to.
    pub inverse: EditorCommand,
}

/// A pending command that no longer applies after a rebase.
#[derive(Clone, Debug, PartialEq)]
pub struct Dropped {
    pub id: String,
    pub command_type: String,
    pub reason: EngineError,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rebased {
    pub scope: EditScope,
    pub dropped: Vec<Dropped>,
}

/// Why a rebase could not run. The queue and the document are unchanged.
#[derive(Clone, Debug, PartialEq)]
pub enum RebaseError {
    /// A pending inverse refused to unwind: the queue no longer matches the document.
    Unwind { id: String, reason: EngineError },
    /// A server-accepted command did not apply: client and server diverged,
    /// and the controller reloads the snapshot.
    Delivered { index: usize, reason: EngineError },
    /// A pending command the server accepted no longer applies here after the
    /// delivered commands: the same divergence, found on re-apply.
    Accepted { id: String, reason: EngineError },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PendingQueue {
    items: Vec<Pending>,
}

impl PendingQueue {
    /// Add a command the user just made, in order.
    pub fn enqueue(&mut self, id: impl Into<String>, command: EditorCommand, inverse: EditorCommand) {
        self.items.push(Pending { id: id.into(), command, inverse });
    }

    /// The server accepted `id`: it leaves the queue. The document is unchanged.
    /// Returns whether the id was pending.
    pub fn ack(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|item| item.id != id);
        self.items.len() != before
    }

    /// Undo pending in reverse, apply `delivered`, re-apply pending in order.
    /// A pending command that no longer applies is dropped and reported. When
    /// that changed the document, the ledger's redo stack is cleared.
    pub fn rebase(&mut self, scope: &EditScope, delivered: &[EditorCommand], ledger: &mut Ledger) -> Result<Rebased, RebaseError> {
        self.resolve(scope, delivered, &[], &[], ledger)
    }

    /// Apply a server reply in one step (`p1-command-log` D3): undo pending in
    /// reverse, apply `delivered`, re-apply pending in order skipping `rejected`,
    /// then remove `accepted` and `rejected` from the queue. Accepted commands
    /// re-apply where the server placed them, after the delivered ones. A
    /// rejected id is not reported as dropped; the caller already has its reason.
    /// Nothing changes on error.
    ///
    /// The redo stack is cleared only when the document under it changed: a
    /// command was delivered, rejected or dropped. A reply that only accepts the
    /// client's own commands leaves the document as it was, so redo stays valid.
    pub fn resolve(
        &mut self,
        scope: &EditScope,
        delivered: &[EditorCommand],
        accepted: &[&str],
        rejected: &[&str],
        ledger: &mut Ledger,
    ) -> Result<Rebased, RebaseError> {
        let unwound = self.items.iter().rev().try_fold(scope.clone(), |state, item| {
            execute(&state, &item.inverse).map(|executed| executed.scope).map_err(|reason| RebaseError::Unwind { id: item.id.clone(), reason })
        })?;
        let applied = delivered.iter().enumerate().try_fold(unwound, |state, (index, command)| {
            execute(&state, command).map(|executed| executed.scope).map_err(|reason| RebaseError::Delivered { index, reason })
        })?;
        let mut kept = Vec::with_capacity(self.items.len());
        let mut dropped = Vec::new();
        let mut state = applied;
        for item in self.items.iter().filter(|item| !rejected.contains(&item.id.as_str())) {
            let is_accepted = accepted.contains(&item.id.as_str());
            match execute(&state, &item.command) {
                Ok(executed) => {
                    state = executed.scope;
                    if !is_accepted {
                        kept.push(Pending { inverse: executed.inverse, ..item.clone() });
                    }
                }
                Err(reason) if is_accepted => return Err(RebaseError::Accepted { id: item.id.clone(), reason }),
                Err(reason) => dropped.push(Dropped { id: item.id.clone(), command_type: command_type(&item.command), reason }),
            }
        }
        self.items = kept;
        if !delivered.is_empty() || !rejected.is_empty() || !dropped.is_empty() {
            ledger.clear_redo();
        }
        Ok(Rebased { scope: state, dropped })
    }

    pub fn items(&self) -> &[Pending] {
        &self.items
    }
}
