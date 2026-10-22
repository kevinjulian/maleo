//! Spike B: the `editor-wasm` calling convention, exported as a native C ABI.
//!
//! The functions mirror `crates/editor-wasm/src/lib.rs` (`mod abi`), which is
//! compiled for `wasm32` only:
//! - the host writes input with `engine_alloc(len)` and passes `(ptr, len)`;
//!   the callee takes ownership and frees it;
//! - a call's text result stays in an output buffer, read with
//!   `engine_output_ptr()` / `engine_output_len()` before the next call;
//! - status `0` means the output is the result, `1` an error object.
//!
//! The registry and output buffer are thread-local, as in WASM: a host calls
//! the engine from one thread.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::RefCell;
use std::sync::atomic::{AtomicIsize, Ordering};

use maleo_editor_wasm::Documents;

#[cfg(target_os = "android")]
mod jni_shim;

/// Counts live heap bytes, so a run can show the engine does not grow.
struct Counting;

static LIVE: AtomicIsize = AtomicIsize::new(0);

// SAFETY: every call forwards to `System` unchanged; only a counter is added.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size() as isize, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size() as isize, Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LIVE.fetch_add(new_size as isize - layout.size() as isize, Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

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
    // SAFETY: `ptr`/`len` come from `engine_alloc(len)`, which leaked a boxed
    // slice of exactly `len` bytes; the host passes each buffer to exactly one
    // call, so it is reclaimed here once.
    let bytes = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    String::from_utf8(bytes.into_vec()).map_err(|_| r#"{"kind":"InvalidInput","message":"input is not UTF-8"}"#.to_owned())
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

/// Live Rust heap bytes (spike measurement only).
#[unsafe(no_mangle)]
pub extern "C" fn spike_live_bytes() -> i64 {
    LIVE.load(Ordering::Relaxed) as i64
}

/// Host-side helpers that drive the C ABI exactly as a foreign host does.
pub mod host {
    use super::*;

    fn input(text: &str) -> (*mut u8, usize) {
        let ptr = engine_alloc(text.len());
        // SAFETY: `engine_alloc` returned a buffer of exactly `text.len()` bytes.
        unsafe { std::ptr::copy_nonoverlapping(text.as_ptr(), ptr, text.len()) };
        (ptr, text.len())
    }

    fn output() -> String {
        // SAFETY: the output buffer is valid until the next engine call.
        let bytes = unsafe { std::slice::from_raw_parts(engine_output_ptr(), engine_output_len()) };
        String::from_utf8(bytes.to_vec()).expect("engine output is UTF-8")
    }

    fn checked(code: u32) -> Result<String, String> {
        if code == 0 { Ok(output()) } else { Err(output()) }
    }

    pub fn open(scope: &str) -> Result<u32, String> {
        let (ptr, len) = input(scope);
        match engine_open(ptr, len) {
            0 => Err(output()),
            handle => Ok(handle),
        }
    }

    pub fn execute(handle: u32, command: &str) -> Result<String, String> {
        let (ptr, len) = input(command);
        checked(engine_execute(handle, ptr, len))
    }

    pub fn read(handle: u32) -> Result<String, String> {
        checked(engine_read(handle))
    }

    pub fn close(handle: u32) -> Result<String, String> {
        checked(engine_close(handle))
    }
}
