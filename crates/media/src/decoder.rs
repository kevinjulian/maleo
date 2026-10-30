//! A host-wide decoder queue. Hosts close codec instances before returning leases.
use crate::visual_pool::VIDEO_DECODERS;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Video,
    Audio,
}
#[derive(Clone, Debug, Serialize)]
pub struct Grant {
    pub owner: u32,
    pub request: u32,
    pub lease: u32,
}
#[derive(Clone)]
struct Pending {
    owner: u32,
    request: u32,
    kind: Kind,
    slots: u32,
}
#[derive(Default)]
pub struct Decoders {
    next_owner: u32,
    next_lease: u32,
    owners: Vec<u32>,
    pending: Vec<Pending>,
    active: Vec<(u32, Pending)>,
    grants: Vec<Grant>,
}
impl Decoders {
    pub fn open(&mut self) -> u32 {
        self.next_owner = self.next_owner.checked_add(1).expect("decoder owner handles exhausted");
        self.owners.push(self.next_owner);
        self.next_owner
    }
    pub fn request(&mut self, owner: u32, request: u32, kind: Kind, slots: u32) -> Result<(), String> {
        if !self.owners.contains(&owner) || request == 0 || slots == 0 || slots > 2 || (kind == Kind::Audio && slots != 1) {
            return Err("Invalid decoder request owner or identity".into());
        }
        if self.pending.iter().chain(self.active.iter().map(|(_, entry)| entry)).any(|entry| entry.owner == owner && entry.request == request) {
            return Err("Duplicate decoder request".into());
        }
        self.pending.push(Pending { owner, request, kind, slots });
        self.pump();
        Ok(())
    }
    fn pump(&mut self) {
        loop {
            let videos: u32 = self.active.iter().filter(|(_, entry)| entry.kind == Kind::Video).map(|(_, entry)| entry.slots).sum();
            let audios = self.active.iter().filter(|(_, entry)| entry.kind == Kind::Audio).count();
            let mut video_waiting = false;
            let next = self.pending.iter().position(|entry| match entry.kind {
                Kind::Video => {
                    if video_waiting {
                        return false;
                    }
                    video_waiting = true;
                    videos + entry.slots <= VIDEO_DECODERS as u32
                }
                Kind::Audio => audios < 2,
            });
            let Some(index) = next else { break };
            let Some(lease) = self.next_lease.checked_add(1) else { break };
            self.next_lease = lease;
            let entry = self.pending.remove(index);
            self.grants.push(Grant { owner: entry.owner, request: entry.request, lease });
            self.active.push((lease, entry));
        }
    }
    pub fn should_yield(&self, owner: u32, lease: u32) -> bool {
        self.active
            .iter()
            .find(|(id, entry)| *id == lease && entry.owner == owner)
            .is_some_and(|(_, active)| self.pending.iter().any(|pending| pending.kind == active.kind))
    }
    pub fn release(&mut self, owner: u32, lease: u32) {
        self.active.retain(|(id, entry)| *id != lease || entry.owner != owner);
        self.pump();
    }
    /// Only after the worker/host's codec instances are closed or terminated.
    pub fn close(&mut self, owner: u32) {
        self.owners.retain(|id| *id != owner);
        self.pending.retain(|entry| entry.owner != owner);
        self.active.retain(|(_, entry)| entry.owner != owner);
        self.grants.retain(|entry| entry.owner != owner);
        self.pump();
    }
    pub fn grants(&mut self) -> Vec<Grant> {
        std::mem::take(&mut self.grants)
    }
}
