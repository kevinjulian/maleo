//! One gesture as a transaction: a port of `edit/transaction.ts`. It opens
//! against a base state, refines a projection on every sample, and ends exactly
//! once — a second terminal phase is rejected, not ignored.

use serde::Serialize;

use super::model::{Operation, Projection, State};
use super::policies::{Intent, Update, move_operation, project_move, project_trim, trim_operation};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Open,
    Committed,
    RolledBack,
}

/// What a terminal phase produced (`TerminalResult`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Terminal {
    Committed {
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation: Option<Operation>,
    },
    Rejected {
        ok: bool,
        rejection: String,
    },
    RolledBack {
        ok: bool,
    },
}

pub struct Transaction {
    pub id: String,
    pub phase: Phase,
    pub intent: Intent,
    pub projection: Projection,
    pub base: State,
}

impl Transaction {
    /// `begin(id, base, intent)`: the projection starts empty.
    pub fn begin(id: impl Into<String>, base: State, intent: Intent) -> Self {
        Transaction { id: id.into(), phase: Phase::Open, intent, projection: Projection::empty(), base }
    }

    /// `update(transaction, change, policy)`: a closed transaction does not change.
    pub fn update(&mut self, update: &Update) -> &Projection {
        if self.phase == Phase::Open {
            self.projection = match &self.intent {
                Intent::Move { id, candidates, cross_axis } => project_move(&self.base, id, candidates, *cross_axis, update),
                Intent::Trim { id, edge, kind, neighbour_id, candidates } => {
                    project_trim(&self.base, id, *edge, *kind, neighbour_id.as_deref(), candidates, update)
                }
            };
        }
        &self.projection
    }

    fn already(&self) -> Terminal {
        let phase = if self.phase == Phase::Committed { "committed" } else { "rolled back" };
        Terminal::Rejected {
            ok: false,
            rejection: format!("@maleo/vui: transaction {} has already {phase}; a transaction has exactly one terminal phase", self.id),
        }
    }

    /// `commit(transaction, policy)`: an invalid projection rolls back with a rejection.
    pub fn commit(&mut self) -> Terminal {
        if self.phase != Phase::Open {
            return self.already();
        }
        if !self.projection.valid {
            let rejection =
                self.projection.reason.clone().unwrap_or_else(|| format!("@maleo/vui: transaction {} cannot commit an invalid projection", self.id));
            self.phase = Phase::RolledBack;
            self.projection = Projection::empty();
            return Terminal::Rejected { ok: false, rejection };
        }
        let operation = match &self.intent {
            Intent::Move { id, .. } => move_operation(&self.base, id, &self.projection),
            Intent::Trim { id, edge, kind, neighbour_id, .. } => trim_operation(&self.base, id, *edge, *kind, neighbour_id.as_deref(), &self.projection),
        };
        self.phase = Phase::Committed;
        Terminal::Committed { ok: true, operation }
    }

    /// `rollback(transaction)`: no operation, and the projection is discarded.
    pub fn rollback(&mut self) -> Terminal {
        if self.phase != Phase::Open {
            return self.already();
        }
        self.phase = Phase::RolledBack;
        self.projection = Projection::empty();
        Terminal::RolledBack { ok: true }
    }
}
