//! The WebAssembly boundary for `maleo-editor-core`.
//!
//! A raw ABI rather than generated glue: the boundary is a handful of calls
//! that move UTF-8 JSON in and out, and a hand-written TS loader
//! (`packages/shared/src/editor/engine.ts`) is smaller than a generator whose
//! CLI must match its crate version.
//!
//! The document lives here, behind a handle. `engine_execute` replaces the
//! handle's scope and returns only the inverse, so an edit never copies the
//! whole document across the boundary; the host reads the scope when it needs
//! it (a save, a render), not per edit.
//!
//! Calling convention:
//! - The host writes input with `engine_alloc(len)` and passes `(ptr, len)`;
//!   the callee takes ownership and frees it.
//! - A call's text result is left in an output buffer, read with
//!   `engine_output_ptr()` / `engine_output_len()` before the next call.
//! - Status `0` means the output is the result; `1` means it is an error
//!   object `{"kind": …, "message": …}`.

use std::cell::RefCell;
use std::collections::BTreeMap;

use maleo_editor_core::json::to_js_string;
use maleo_editor_core::policy::model::State;
use maleo_editor_core::policy::policies::Intent;
use maleo_editor_core::policy::session::Transaction;
use maleo_editor_core::time::{self, CONTENT_TIMEBASE};
use maleo_editor_core::{EditScope, EngineError, admit_command, admit_scope, execute, execute_json};

/// An error as the host receives it.
pub fn error_json(error: &EngineError) -> String {
    let kind = match error {
        EngineError::InvalidInput(_) => "InvalidInput",
        EngineError::UnsupportedSchemaVersion(_) => "UnsupportedSchemaVersion",
        EngineError::UnknownCommand(_) => "UnknownCommand",
        EngineError::UnknownCommandField { .. } => "UnknownCommandField",
        EngineError::NotPorted(_) => "NotPorted",
        EngineError::ClipNotFound(_) => "ClipNotFound",
        EngineError::InvalidSourceInterval(_) => "InvalidSourceInterval",
    };
    serde_json::json!({ "kind": kind, "message": error.to_string() }).to_string()
}

fn unknown_handle(handle: u32) -> String {
    serde_json::json!({ "kind": "UnknownHandle", "message": format!("no open document with handle {handle}") }).to_string()
}

/// Open documents. WebAssembly here is single-threaded, so one registry per
/// instance; handles start at 1 so 0 can mean "not opened".
#[derive(Default)]
pub struct Documents {
    next: u32,
    scopes: BTreeMap<u32, EditScope>,
}

impl Documents {
    pub fn open(&mut self, scope_json: &str) -> Result<u32, String> {
        let scope = admit_scope(scope_json).map_err(|error| error_json(&error))?;
        self.next += 1;
        self.scopes.insert(self.next, scope);
        Ok(self.next)
    }

    /// Execute against the handle's scope; on success the handle holds the new
    /// scope and the inverse is returned. On failure the scope is unchanged.
    pub fn execute(&mut self, handle: u32, command_json: &str) -> Result<String, String> {
        let scope = self.scopes.get(&handle).ok_or_else(|| unknown_handle(handle))?;
        let command = admit_command(command_json).map_err(|error| error_json(&error))?;
        let executed = execute(scope, &command).map_err(|error| error_json(&error))?;
        let inverse = to_js_string(&executed.inverse).map_err(|message| error_json(&EngineError::InvalidInput(message)))?;
        self.scopes.insert(handle, executed.scope);
        Ok(inverse)
    }

    /// Execute like `execute`, returning `{"inverse": …, "delta": …}`: the delta
    /// names only the parts of the scope the edit replaced
    /// (`maleo_editor_core::delta`), so a host keeping its own copy rebuilds it
    /// without reading the whole document back.
    pub fn execute_delta(&mut self, handle: u32, command_json: &str) -> Result<String, String> {
        let scope = self.scopes.get(&handle).ok_or_else(|| unknown_handle(handle))?;
        let command = admit_command(command_json).map_err(|error| error_json(&error))?;
        let executed = execute(scope, &command).map_err(|error| error_json(&error))?;
        let delta = maleo_editor_core::delta::delta(scope, &executed.scope).map_err(invalid)?;
        let inverse = to_js_string(&executed.inverse).map_err(invalid)?;
        let out = format!("{{\"inverse\":{inverse},\"delta\":{delta}}}");
        self.scopes.insert(handle, executed.scope);
        Ok(out)
    }

    pub fn read(&self, handle: u32) -> Result<String, String> {
        let scope = self.scopes.get(&handle).ok_or_else(|| unknown_handle(handle))?;
        to_js_string(scope).map_err(|message| error_json(&EngineError::InvalidInput(message)))
    }

    pub fn close(&mut self, handle: u32) -> Result<(), String> {
        self.scopes.remove(&handle).map(|_| ()).ok_or_else(|| unknown_handle(handle))
    }

    pub fn open_count(&self) -> usize {
        self.scopes.len()
    }
}

/// Open gestures: one edit-policy transaction each (task 4.2). The base state
/// crosses once, at open; every pointer sample afterwards sends only the
/// update and receives only the projection.
#[derive(Default)]
pub struct Gestures {
    next: u32,
    open: BTreeMap<u32, Transaction>,
}

fn invalid(message: impl Into<String>) -> String {
    error_json(&EngineError::InvalidInput(message.into()))
}

fn unknown_gesture(handle: u32) -> String {
    serde_json::json!({ "kind": "UnknownHandle", "message": format!("no open gesture with handle {handle}") }).to_string()
}

impl Gestures {
    pub fn open(&mut self, state_json: &str, begin_json: &str) -> Result<u32, String> {
        let state = State::from_json(state_json).map_err(invalid)?;
        // `{"id": "…", "intent": {…}}`: the transaction's name, used in its rejections, and what it does.
        let mut begin: serde_json::Value = serde_json::from_str(begin_json).map_err(|error| invalid(error.to_string()))?;
        let id = begin.get("id").and_then(serde_json::Value::as_str).ok_or_else(|| invalid("a gesture needs a string `id`"))?.to_owned();
        let intent = Intent::from_value(begin["intent"].take()).map_err(|error| invalid(format!("intent: {error}")))?;
        self.next += 1;
        self.open.insert(self.next, Transaction::begin(id, state, intent));
        Ok(self.next)
    }

    pub fn update(&mut self, handle: u32, update_json: &str) -> Result<String, String> {
        let transaction = self.open.get_mut(&handle).ok_or_else(|| unknown_gesture(handle))?;
        let update =
            maleo_editor_core::policy::decode::parse(update_json).and_then(|value| maleo_editor_core::policy::decode::update(&value)).map_err(invalid)?;
        to_js_string(transaction.update(&update)).map_err(invalid)
    }

    pub fn commit(&mut self, handle: u32) -> Result<String, String> {
        let transaction = self.open.get_mut(&handle).ok_or_else(|| unknown_gesture(handle))?;
        to_js_string(&transaction.commit()).map_err(invalid)
    }

    pub fn rollback(&mut self, handle: u32) -> Result<String, String> {
        let transaction = self.open.get_mut(&handle).ok_or_else(|| unknown_gesture(handle))?;
        to_js_string(&transaction.rollback()).map_err(invalid)
    }

    pub fn close(&mut self, handle: u32) -> Result<(), String> {
        self.open.remove(&handle).map(|_| ()).ok_or_else(|| unknown_gesture(handle))
    }

    pub fn open_count(&self) -> usize {
        self.open.len()
    }
}

/// Stateless execution, for parity checks and one-off calls.
pub fn execute_once(scope_json: &str, command_json: &str) -> Result<String, String> {
    execute_json(scope_json, command_json).map_err(|error| error_json(&error))
}

/// A ruler label: `frames` as timecode at `frame_rate` (numerator/denominator)
/// with `ticks_per_frame`, counted drop-frame when asked (task 4.10).
pub fn format_timecode(frames: f64, numerator: f64, denominator: f64, ticks_per_frame: f64, drop_frame: bool) -> Result<String, String> {
    let base = time::timebase(time::rational(numerator, denominator)?, ticks_per_frame)?;
    Ok(time::format_timecode_parts(time::frames_to_timecode_parts(frames, base, drop_frame)?))
}

/// `snap(ticks, candidates, options)` for a host that snaps outside a gesture
/// (a media drop): `{"ticks", "candidates", "thresholdPx", "scale", "bypass"?,
/// "moving"?}` in, `{"ticks", "candidate"?}` out.
pub fn snap_json(json: &str) -> Result<String, String> {
    use maleo_editor_core::policy::{axis, decode};
    let value = decode::parse(json).map_err(invalid)?;
    let number = |name: &str| value.get(name).and_then(serde_json::Value::as_f64).ok_or_else(|| invalid(format!("`{name}` is not a number")));
    let moving: std::collections::BTreeSet<String> = value
        .get("moving")
        .and_then(serde_json::Value::as_array)
        .map(|ids| ids.iter().filter_map(|id| id.as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    let options = axis::SnapOptions {
        threshold_px: number("thresholdPx")?,
        scale: number("scale")?,
        moving: Some(&moving),
        bypass: value.get("bypass").and_then(serde_json::Value::as_bool).unwrap_or(false),
    };
    let candidates = decode::candidates(&value).map_err(invalid)?;
    let (ticks, candidate) = axis::snap(number("ticks")?, &candidates, &options);
    let candidate = candidate.as_ref().map_or_else(|| Ok("null".to_owned()), to_js_string).map_err(invalid)?;
    let ticks = maleo_editor_core::json::js_number_string(ticks).ok_or_else(|| invalid("snapped to a non-finite position"))?;
    Ok(format!("{{\"ticks\":{ticks},\"candidate\":{candidate}}}"))
}

/// Content-timebase ticks for `seconds`, or NaN when unrepresentable.
pub fn seconds_to_ticks(seconds: f64) -> f64 {
    // The boundary refuses a tick count past the safe-integer range rather than
    // handing the host a number it cannot hold exactly.
    time::seconds_to_ticks(seconds, CONTENT_TIMEBASE)
        .ok()
        .filter(|rounded| rounded.value.abs() <= time::MAX_SAFE_INTEGER)
        .map_or(f64::NAN, |rounded| rounded.value)
}

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::{Documents, execute_once, seconds_to_ticks};
    use std::cell::RefCell;

    thread_local! {
        static DOCUMENTS: RefCell<Documents> = RefCell::new(Documents::default());
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    fn set_output(text: String) {
        OUTPUT.with(|output| *output.borrow_mut() = text.into_bytes());
    }

    fn status(result: Result<String, String>) -> u32 {
        match result {
            Ok(text) => {
                set_output(text);
                0
            }
            Err(error) => {
                set_output(error);
                1
            }
        }
    }

    /// Take ownership of a buffer the host filled after `engine_alloc(len)`.
    fn take_input(ptr: *mut u8, len: usize) -> Result<String, String> {
        // SAFETY: `ptr`/`len` come from `engine_alloc(len)`, which leaked a
        // boxed slice of exactly `len` bytes; the host passes each buffer to
        // exactly one call, so it is reclaimed here once.
        let bytes = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
        String::from_utf8(bytes.into_vec()).map_err(|_| super::error_json(&maleo_editor_core::EngineError::InvalidInput("input is not UTF-8".into())))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_alloc(len: usize) -> *mut u8 {
        Box::into_raw(vec![0u8; len].into_boxed_slice()).cast::<u8>()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_output_ptr() -> *const u8 {
        OUTPUT.with(|output| output.borrow().as_ptr())
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_output_len() -> usize {
        OUTPUT.with(|output| output.borrow().len())
    }

    /// Returns a handle, or 0 with the error in the output buffer.
    #[unsafe(no_mangle)]
    pub extern "C" fn engine_open(ptr: *mut u8, len: usize) -> u32 {
        match take_input(ptr, len).and_then(|json| DOCUMENTS.with(|documents| documents.borrow_mut().open(&json))) {
            Ok(handle) => {
                set_output(String::new());
                handle
            }
            Err(error) => {
                set_output(error);
                0
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_execute(handle: u32, ptr: *mut u8, len: usize) -> u32 {
        status(take_input(ptr, len).and_then(|json| DOCUMENTS.with(|documents| documents.borrow_mut().execute(handle, &json))))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_execute_delta(handle: u32, ptr: *mut u8, len: usize) -> u32 {
        status(take_input(ptr, len).and_then(|json| DOCUMENTS.with(|documents| documents.borrow_mut().execute_delta(handle, &json))))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_read(handle: u32) -> u32 {
        status(DOCUMENTS.with(|documents| documents.borrow().read(handle)))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_close(handle: u32) -> u32 {
        status(DOCUMENTS.with(|documents| documents.borrow_mut().close(handle)).map(|()| String::new()))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_open_count() -> u32 {
        DOCUMENTS.with(|documents| documents.borrow().open_count() as u32)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_execute_once(scope_ptr: *mut u8, scope_len: usize, command_ptr: *mut u8, command_len: usize) -> u32 {
        let scope = take_input(scope_ptr, scope_len);
        let command = take_input(command_ptr, command_len);
        status(scope.and_then(|scope| command.and_then(|command| execute_once(&scope, &command))))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn time_format_timecode(frames: f64, numerator: f64, denominator: f64, ticks_per_frame: f64, drop_frame: u32) -> u32 {
        status(super::format_timecode(frames, numerator, denominator, ticks_per_frame, drop_frame != 0).map_err(|message| super::invalid(message)))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_snap(ptr: *mut u8, len: usize) -> u32 {
        status(take_input(ptr, len).and_then(|json| super::snap_json(&json)))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn engine_seconds_to_ticks(seconds: f64) -> f64 {
        seconds_to_ticks(seconds)
    }

    thread_local! {
        static GESTURES: RefCell<super::Gestures> = RefCell::new(super::Gestures::default());
    }

    /// Returns a gesture handle, or 0 with the error in the output buffer.
    #[unsafe(no_mangle)]
    pub extern "C" fn policy_open(state_ptr: *mut u8, state_len: usize, begin_ptr: *mut u8, begin_len: usize) -> u32 {
        let state = take_input(state_ptr, state_len);
        let begin = take_input(begin_ptr, begin_len);
        match state.and_then(|state| begin.and_then(|begin| GESTURES.with(|gestures| gestures.borrow_mut().open(&state, &begin)))) {
            Ok(handle) => {
                set_output(String::new());
                handle
            }
            Err(error) => {
                set_output(error);
                0
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_update(handle: u32, ptr: *mut u8, len: usize) -> u32 {
        status(take_input(ptr, len).and_then(|json| GESTURES.with(|gestures| gestures.borrow_mut().update(handle, &json))))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_commit(handle: u32) -> u32 {
        status(GESTURES.with(|gestures| gestures.borrow_mut().commit(handle)))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_rollback(handle: u32) -> u32 {
        status(GESTURES.with(|gestures| gestures.borrow_mut().rollback(handle)))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_close(handle: u32) -> u32 {
        status(GESTURES.with(|gestures| gestures.borrow_mut().close(handle)).map(|()| String::new()))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn policy_open_count() -> u32 {
        GESTURES.with(|gestures| gestures.borrow().open_count() as u32)
    }
}

// The registry type is also what the native parity runner drives.
thread_local! {
    static NATIVE: RefCell<Documents> = RefCell::new(Documents::default());
}

/// The native runner's registry, so a sequence run natively follows the same
/// open/execute/read/close path as one run through WASM.
pub fn with_native_documents<T>(run: impl FnOnce(&mut Documents) -> T) -> T {
    NATIVE.with(|documents| run(&mut documents.borrow_mut()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = r#"{"mediaAssets":[],"slides":[],"posts":[],"doc":{"schemaVersion":2,"markers":[],"clips":[{"id":"text:1","type":"text","startSec":1,"durationSec":2,"track":0}]}}"#;

    #[test]
    fn a_handle_holds_the_scope_across_edits() {
        let mut documents = Documents::default();
        let handle = documents.open(SCOPE).expect("opens");
        let inverse = documents.execute(handle, r#"{"type":"clip.move","id":"text:1","patch":{"startSec":4}}"#).expect("moves");
        assert!(inverse.contains(r#""startSec":1"#), "{inverse}");
        assert!(documents.read(handle).expect("reads").contains(r#""startSec":4"#));
        documents.execute(handle, &inverse).expect("undoes");
        let out = documents.execute_delta(handle, r#"{"type":"clip.move","id":"text:1","patch":{"startSec":4}}"#).expect("moves");
        assert!(out.contains(r#""delta":{"doc":{"clips":[{"id":"text:1""#), "{out}");
        documents.execute_delta(handle, &inverse).expect("undoes");
        assert!(documents.read(handle).expect("reads").contains(r#""startSec":1"#));
        documents.close(handle).expect("closes");
        assert_eq!(documents.open_count(), 0);
    }

    #[test]
    fn a_failed_edit_leaves_the_handle_unchanged() {
        let mut documents = Documents::default();
        let handle = documents.open(SCOPE).expect("opens");
        let before = documents.read(handle).expect("reads");
        let error =
            documents.execute(handle, r#"{"type":"clip.setKeys","id":"text:1","property":"opacity","keys":[],"ripple":true}"#).expect_err("unknown field");
        assert!(error.contains(r#""kind":"UnknownCommandField""#), "{error}");
        assert_eq!(documents.read(handle).expect("reads"), before);
        assert!(documents.execute(99, r#"{"type":"noop"}"#).expect_err("no handle").contains("UnknownHandle"));
        assert!(documents.close(99).is_err());
    }

    #[test]
    fn a_ruler_label_is_timecode_drop_frame_when_asked() {
        assert_eq!(format_timecode(1800.0, 30.0, 1.0, 1000.0, false).expect("formats"), "00:01:00:00");
        assert_eq!(format_timecode(1800.0, 30000.0, 1001.0, 1001.0, true).expect("formats"), "00;01;00;02");
        assert!(format_timecode(-1.0, 30.0, 1.0, 1000.0, false).is_err());
    }

    #[test]
    fn a_drop_snaps_to_the_nearest_candidate_unless_bypassed() {
        let json = r#"{"ticks":5900,"candidates":[{"ticks":5000,"kind":"clip-end","itemId":"a"},{"ticks":6000,"kind":"clip-start","itemId":"b"}],"thresholdPx":8,"scale":0.02,"moving":["b"]}"#;
        assert_eq!(snap_json(json).expect("snaps"), r#"{"ticks":5900,"candidate":null}"#);
        let free = json.replace(r#","moving":["b"]"#, "");
        assert_eq!(snap_json(&free).expect("snaps"), r#"{"ticks":6000,"candidate":{"ticks":6000,"kind":"clip-start","itemId":"b"}}"#);
        assert_eq!(snap_json(&free.replace("}]", r#"}],"bypass":true"#)).expect("snaps"), r#"{"ticks":5900,"candidate":null}"#);
    }
}
