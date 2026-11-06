//! Editor state rules shared by every controller (OpenSpec `p1-app-core`):
//! the undo ledger, the selection rules and the queue of pending local
//! commands; and the inspector rules (`p1-envelope-inspector`). Host-free like
//! `maleo-editor-core`, which it executes through; it never holds its own copy
//! of the document.

pub mod animation_edit;
pub mod canvas;
pub mod controls;
pub mod inspector;
pub mod keys;
pub mod layout;
pub mod ledger;
pub mod ops;
pub mod pending;
pub mod selection;

pub use ledger::{Ledger, UndoRefused};
pub use pending::{Dropped, PendingQueue, RebaseError, Rebased};
pub use selection::{Action, ClipSource, Selection};
