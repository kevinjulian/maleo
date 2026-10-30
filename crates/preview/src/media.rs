//! Read-only readiness facts from the shared complete-source reducer.
#[derive(Clone, Debug, PartialEq)]
pub struct Blocker {
    pub clip_id: String,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Readiness {
    pub revision: String,
    pub generation: u32,
    pub sequence: u64,
    pub ready: bool,
    pub blockers: Vec<Blocker>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Playback {
    Ready,
    Buffering,
    Stalled(String),
}
impl Readiness {
    pub fn validate(&self) -> Result<(), String> {
        if self.revision.is_empty()
            || self.sequence > (1u64 << 53) - 1
            || (self.ready && !self.blockers.is_empty())
            || self.blockers.iter().any(|blocker| blocker.clip_id.is_empty() || blocker.message.is_empty())
        {
            return Err("Invalid preview media readiness".into());
        }
        Ok(())
    }
}
