//! Native half of the cross-runtime parity check (task 2.3/2.4).
//!
//! Reads parity cases from stdin and writes one result per case to stdout, as
//! JSON. `packages/shared/src/editor/engine-parity.ts` runs the same cases
//! through the WASM build in a browser and in Bun and requires identical
//! strings. Scopes and commands arrive as strings, so every runtime receives
//! the same bytes.

use std::io::{Read, Write};

use maleo_editor_wasm::{execute_once, seconds_to_ticks, with_native_documents};
use serde_json::{Value, json};

fn outcome(result: Result<String, String>) -> Value {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    }
}

fn run(case: &Value) -> Value {
    let text = |key: &str| case[key].as_str().unwrap_or_default().to_owned();
    match case["kind"].as_str() {
        Some("once") => outcome(execute_once(&text("scope"), &text("command"))),
        Some("sequence") => with_native_documents(|documents| {
            let handle = match documents.open(&text("scope")) {
                Ok(handle) => handle,
                Err(error) => return json!({ "open": { "error": error } }),
            };
            let steps: Vec<Value> = case["commands"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|command| outcome(documents.execute(handle, command.as_str().unwrap_or_default())))
                .collect();
            let last = outcome(documents.read(handle));
            let closed = documents.close(handle).is_ok();
            json!({ "steps": steps, "final": last, "closed": closed, "open": documents.open_count() })
        }),
        Some("ticks") => {
            let ticks: Vec<Value> = case["seconds"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|seconds| {
                    let value = seconds_to_ticks(seconds.as_f64().unwrap_or(f64::NAN));
                    if value.is_nan() { Value::Null } else { json!(value as i64) }
                })
                .collect();
            json!({ "ticks": ticks })
        }
        other => json!({ "error": format!("unknown case kind {other:?}") }),
    }
}

fn main() {
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("parity: cannot read stdin: {error}");
        std::process::exit(2);
    }
    let cases: Value = match serde_json::from_str(&input) {
        Ok(cases) => cases,
        Err(error) => {
            eprintln!("parity: stdin is not JSON: {error}");
            std::process::exit(2);
        }
    };
    let results: Vec<Value> = cases.as_array().into_iter().flatten().map(run).collect();
    let out = serde_json::to_string(&results).unwrap_or_else(|error| format!("[\"parity: {error}\"]"));
    if let Err(error) = std::io::stdout().write_all(out.as_bytes()) {
        eprintln!("parity: cannot write stdout: {error}");
        std::process::exit(2);
    }
}
