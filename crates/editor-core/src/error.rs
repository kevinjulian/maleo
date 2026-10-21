//! Every way admission or execution can refuse, as data a host can report.

use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub enum EngineError {
    /// The input is not JSON, or not the shape the contract describes.
    InvalidInput(String),
    /// The scope's `doc.schemaVersion` is not one this engine admits.
    UnsupportedSchemaVersion(String),
    /// The command's `type` is not in the vocabulary at all.
    UnknownCommand(String),
    /// The command carries a field its type does not define.
    UnknownCommandField { command: String, field: String },
    /// Part of the vocabulary or a clip shape this build does not execute yet.
    NotPorted(String),
    /// An inverse needs a clip the prior scope does not have (the TS executor throws here too).
    ClipNotFound(String),
    /// Source timing that cannot describe a playable interval.
    InvalidSourceInterval(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(detail) => write!(f, "invalid input: {detail}"),
            Self::UnsupportedSchemaVersion(found) => write!(f, "unsupported document schemaVersion {found}; this engine admits 2"),
            Self::UnknownCommand(kind) => write!(f, "unknown command type {kind:?}"),
            Self::UnknownCommandField { command, field } => write!(f, "command {command:?} has no field {field:?}"),
            Self::NotPorted(what) => write!(f, "not executed by this engine build yet: {what}"),
            Self::ClipNotFound(id) => write!(f, "clip {id:?} not found in prior state"),
            Self::InvalidSourceInterval(detail) => write!(f, "invalid source interval: {detail}"),
        }
    }
}

impl std::error::Error for EngineError {}

pub type EngineResult<T> = Result<T, EngineError>;
