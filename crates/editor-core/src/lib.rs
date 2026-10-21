//! The shared editor engine: admits an editing scope and a command, and returns
//! the new scope and the command that undoes it.
//!
//! Host-free by construction: no IO, no clock, no platform API. Web and the
//! API reach it through WASM; native clients call it directly or through
//! generated bindings (OpenSpec `migrate-editor-to-shared-rust-core`).
//!
//! The contract is the TS executor in `packages/shared/src/editor/` and its
//! golden fixtures; `tests/fixtures.rs` holds this crate to both.

mod caption_results;
mod caption_sources;
pub mod captions;
pub mod command;
pub mod delta;
pub mod error;
pub mod execute;
pub mod json;
pub mod keyframes;
pub mod keys;
pub mod policy;
pub mod schema;
pub mod source;
pub mod time;
pub mod window;

pub use command::{EditorCommand, admit_command};
pub use error::{EngineError, EngineResult};
pub use execute::{Executed, apply_command, execute, invert_command};
pub use schema::{Clip, ClipType, EditScope, EditorDoc, admit_scope};

/// The whole boundary in one call: admit both inputs, execute, and return
/// `{"scope": …, "inverse": …}` serialized as `JSON.stringify` would.
pub fn execute_json(scope_json: &str, command_json: &str) -> EngineResult<String> {
    let scope = admit_scope(scope_json)?;
    let command = admit_command(command_json)?;
    let executed = execute(&scope, &command)?;
    json::to_js_string(&executed).map_err(EngineError::InvalidInput)
}
