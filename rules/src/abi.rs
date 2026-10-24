//! Minimal C ABI for the WebAssembly build.
//!
//! The JS loader (`module/scripts/rules.mjs`) does:
//! 1. `ptr = genesis_alloc(len)` and copies a UTF-8 JSON request into linear memory,
//! 2. `out = genesis_call(ptr, len)`, then reads `genesis_result_len()` bytes from `out`,
//! 3. frees both buffers with `genesis_free`.
//!
//! Using a JSON string boundary avoids a wasm-bindgen toolchain dependency entirely.

use std::sync::atomic::{AtomicUsize, Ordering};

static RESULT_LEN: AtomicUsize = AtomicUsize::new(0);

/// Allocate `len` bytes the host can write a request into.
#[unsafe(no_mangle)]
pub extern "C" fn genesis_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Release a buffer previously returned by [`genesis_alloc`] or [`genesis_call`].
///
/// # Safety
/// `ptr` must come from this module and `capacity` must be the length it was created with.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn genesis_free(ptr: *mut u8, capacity: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: both allocation paths produce a Vec/Box<[u8]> whose capacity equals `capacity`.
    unsafe { drop(Vec::from_raw_parts(ptr, 0, capacity.max(1))) };
}

/// Execute one JSON command. Returns a pointer to the UTF-8 JSON response; its length is
/// available from [`genesis_result_len`] until the next call.
///
/// # Safety
/// `ptr..ptr+len` must be a readable region written by the host.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn genesis_call(ptr: *const u8, len: usize) -> *mut u8 {
    // SAFETY: the host guarantees the region is valid for `len` bytes.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let response = match std::str::from_utf8(bytes) {
        Ok(text) => crate::api::dispatch(text),
        Err(_) => crate::api::error_response("Request was not valid UTF-8"),
    };
    let mut out = response.into_bytes();
    out.shrink_to_fit();
    let mut boxed = out.into_boxed_slice();
    RESULT_LEN.store(boxed.len(), Ordering::Relaxed);
    let raw = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    raw
}

/// Length in bytes of the most recent [`genesis_call`] response.
#[unsafe(no_mangle)]
pub extern "C" fn genesis_result_len() -> usize {
    RESULT_LEN.load(Ordering::Relaxed)
}
