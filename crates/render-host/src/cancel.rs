//! SIGTERM as a flag (OpenSpec p2-export E4). The render worker cancels a job
//! by sending SIGTERM; the frame loop and the mixer check the flag between
//! frames and blocks, so the host stops within one frame and cleans up.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    /// Sets the flag on SIGTERM and SIGINT.
    pub fn on_signals() -> Result<Self, String> {
        let flag = Arc::new(AtomicBool::new(false));
        for signal in [signal_hook::consts::SIGTERM, signal_hook::consts::SIGINT] {
            signal_hook::flag::register(signal, flag.clone()).map_err(|e| format!("signal handler: {e}"))?;
        }
        Ok(Self(flag))
    }

    pub fn requested(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}
