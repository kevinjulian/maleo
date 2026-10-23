//! Editor state rules shared by every controller (OpenSpec `p1-app-core`):
//! the undo ledger, the selection rules and the queue of pending local
//! commands. Host-free like `maleo-editor-core`, which it executes through;
//! it never holds its own copy of the document.

pub mod ledger;
pub mod pending;
pub mod selection;

pub use ledger::{Ledger, UndoRefused};
pub use pending::{Dropped, PendingQueue, RebaseError, Rebased};
pub use selection::{Action, ClipSource, Selection};
