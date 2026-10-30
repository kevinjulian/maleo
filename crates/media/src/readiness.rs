use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub id: String,
    pub revision: String,
    pub url: String,
    pub kinds: Vec<Kind>,
    pub clip_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
    Audio,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip {
    pub id: String,
    pub source_ids: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Dependencies {
    pub sources: Vec<Source>,
    pub clips: Vec<Clip>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub generation: u32,
    pub source_id: String,
    pub revision: String,
    pub attempt: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "state", rename_all = "lowercase", deny_unknown_fields)]
pub enum State {
    Queued,
    Loading { loaded: u64, total: Option<u64> },
    Validating,
    Ready,
    Failed { message: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Completion {
    Progress { loaded: u64, total: Option<u64> },
    Validating,
    Ready { eof: bool, readable: bool, bytes: u64, expected: Option<u64>, validated: bool, decoded: bool },
    Failed { message: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipReadiness {
    pub id: String,
    pub state: State,
    pub loaded: u64,
    pub total: Option<u64>,
    pub blockers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generation: u32,
    pub ready: bool,
    pub sources: BTreeMap<String, State>,
    pub clips: Vec<ClipReadiness>,
}

struct Held {
    source: Source,
    state: State,
    attempt: u32,
    loaded: u64,
    total: Option<u64>,
}

#[derive(Default)]
pub struct Readiness {
    generation: u32,
    sources: BTreeMap<String, Held>,
    clips: Vec<Clip>,
}

impl Readiness {
    /// Validate before replacing state. Document-only edits retain complete local bytes.
    pub fn update(&mut self, dependencies: Dependencies) -> Result<Snapshot, String> {
        let ids: BTreeSet<_> = dependencies.sources.iter().map(|s| s.id.as_str()).collect();
        let clips: BTreeSet<_> = dependencies.clips.iter().map(|c| c.id.as_str()).collect();
        if ids.len() != dependencies.sources.len() || clips.len() != dependencies.clips.len() {
            return Err("Duplicate media source or clip identity".into());
        }
        for source in &dependencies.sources {
            if source.id.is_empty() || source.revision.is_empty() || source.url.is_empty() || source.kinds.is_empty() {
                return Err("Media source requires identity, revision and URL".into());
            }
            let users: BTreeSet<_> = dependencies.clips.iter().filter(|c| c.source_ids.contains(&source.id)).map(|c| c.id.as_str()).collect();
            let declared: BTreeSet<_> = source.clip_ids.iter().map(String::as_str).collect();
            if users.is_empty() || users != declared {
                return Err("Media source consumers do not match clip dependencies".into());
            }
        }
        for clip in &dependencies.clips {
            if clip.id.is_empty() || clip.source_ids.iter().any(|id| !ids.contains(id.as_str())) {
                return Err("Clip has an invalid media dependency".into());
            }
        }
        let same = dependencies.sources.len() == self.sources.len()
            && dependencies.sources.iter().all(|s| self.sources.get(&s.id).is_some_and(|h| same_bytes(&h.source, s)))
            && dependencies.clips.iter().all(|c| self.clips.iter().find(|old| old.id == c.id).is_none_or(|old| old.blockers == c.blockers));
        if !same {
            self.generation = self.generation.checked_add(1).ok_or("Media generation exhausted")?;
        }
        let mut next = BTreeMap::new();
        for source in dependencies.sources {
            let held = self.sources.remove(&source.id);
            let held = match held {
                Some(mut held) if same_bytes(&held.source, &source) && (same || matches!(held.state, State::Ready | State::Failed { .. })) => {
                    held.source = source;
                    held
                }
                _ => Held { source, state: State::Queued, attempt: 0, loaded: 0, total: None },
            };
            next.insert(held.source.id.clone(), held);
        }
        self.sources = next;
        self.clips = dependencies.clips;
        Ok(self.snapshot())
    }

    pub fn requests(&self) -> Vec<Request> {
        self.sources
            .values()
            .filter(|h| matches!(h.state, State::Queued))
            .map(|h| Request { generation: self.generation, source_id: h.source.id.clone(), revision: h.source.revision.clone(), attempt: h.attempt })
            .collect()
    }

    /// Late completions, including completions from an earlier Retry, have no effect.
    pub fn complete(&mut self, request: &Request, completion: Completion) -> bool {
        let Some(held) = self.sources.get_mut(&request.source_id) else { return false };
        if request.generation != self.generation
            || request.revision != held.source.revision
            || request.attempt != held.attempt
            || matches!(held.state, State::Ready | State::Failed { .. })
            || (matches!(held.state, State::Validating) && matches!(completion, Completion::Progress { .. }))
        {
            return false;
        }
        held.state = match completion {
            Completion::Progress { loaded, total } => {
                if loaded < held.loaded || total.is_some_and(|total| loaded > total) {
                    State::Failed { message: "Invalid media byte progress".into() }
                } else {
                    held.loaded = loaded;
                    held.total = total;
                    State::Loading { loaded, total }
                }
            }
            Completion::Validating => State::Validating,
            Completion::Ready { eof, readable, bytes, expected, validated, decoded } => {
                if eof && readable && bytes > 0 && expected.is_none_or(|expected| expected == bytes) && validated && decoded {
                    held.loaded = bytes;
                    held.total = Some(bytes);
                    State::Ready
                } else {
                    State::Failed { message: "Complete local bytes and initial media validation are required".into() }
                }
            }
            Completion::Failed { message } => State::Failed { message: if message.is_empty() { "Media adapter failed".into() } else { message } },
        };
        true
    }

    /// Local bytes or validation can be lost after readiness. Reject reports from obsolete consumers.
    pub fn invalidate(&mut self, request: &Request, message: String) -> bool {
        let Some(held) = self.sources.get_mut(&request.source_id) else { return false };
        if request.generation != self.generation || request.revision != held.source.revision || request.attempt != held.attempt {
            return false;
        }
        let Some(attempt) = held.attempt.checked_add(1) else { return false };
        held.attempt = attempt;
        held.state = State::Failed { message: if message.is_empty() { "Local preview source is unavailable. Retry this source.".into() } else { message } };
        true
    }

    pub fn retry(&mut self, id: &str) -> Result<Snapshot, String> {
        let held = self.sources.get_mut(id).ok_or("Unknown media source")?;
        if matches!(held.state, State::Failed { .. }) {
            held.attempt = held.attempt.checked_add(1).ok_or("Media attempts exhausted")?;
            held.state = State::Queued;
            held.loaded = 0;
            held.total = None;
        }
        Ok(self.snapshot())
    }

    pub fn snapshot(&self) -> Snapshot {
        let clips: Vec<_> = self
            .clips
            .iter()
            .map(|clip| {
                let mut state = State::Ready;
                let mut loaded = 0u64;
                let mut total = Some(0u64);
                let mut blockers = clip.blockers.clone();
                for id in &clip.source_ids {
                    let held = &self.sources[id];
                    if priority(&held.state) > priority(&state) {
                        state = held.state.clone();
                    }
                    loaded = loaded.saturating_add(held.loaded);
                    total = total.zip(held.total).and_then(|(a, b)| a.checked_add(b));
                    if let State::Failed { message } = &held.state {
                        blockers.push(message.clone());
                    }
                }
                if let Some(message) = blockers.first() {
                    state = State::Failed { message: message.clone() };
                }
                ClipReadiness { id: clip.id.clone(), state, loaded, total, blockers }
            })
            .collect();
        let ready = clips.iter().all(|c| matches!(c.state, State::Ready));
        Snapshot { generation: self.generation, ready, sources: self.sources.iter().map(|(id, h)| (id.clone(), h.state.clone())).collect(), clips }
    }
}

fn same_bytes(a: &Source, b: &Source) -> bool {
    a.id == b.id && a.revision == b.revision && a.url == b.url && a.kinds == b.kinds
}

fn priority(state: &State) -> u8 {
    match state {
        State::Ready => 0,
        State::Validating => 1,
        State::Loading { .. } => 2,
        State::Queued => 3,
        State::Failed { .. } => 4,
    }
}
