//! Host run of spike B. Writes, into `<out>`:
//! - `fixtures.tsv`: `name \t scope \t command`, the exact inputs every target gets;
//! - `bench.tsv`: `scope \t command` for the latency run;
//! - `host-results.tsv`: `name \t after \t inverse \t restored`, the reference.
//!
//! cargo run --release --bin host -- <repo>/packages/shared/src/editor <out>

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use maleo_kmp_core::{host, spike_live_bytes};
use serde_json::Value;

/// One typical edit on a real project: move the first clip by half a second.
const BENCH_SCOPE: &str = "corpus/scopes/video-s-0e71d5854634.json";
const CALLS: usize = 10_000;

fn sorted(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir).expect("readable dir").map(|e| e.expect("entry").path()).collect();
    entries.sort();
    entries
}

/// The run every target repeats: open, edit, read, undo, read, close.
fn run(scope: &str, command: &str) -> String {
    let handle = host::open(scope).expect("opens");
    let inverse = host::execute(handle, command).expect("executes");
    let after = host::read(handle).expect("reads");
    host::execute(handle, &inverse).expect("undoes");
    let restored = host::read(handle).expect("reads");
    host::close(handle).expect("closes");
    format!("{after}\t{inverse}\t{restored}")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let editor = PathBuf::from(&args[1]);
    let out = PathBuf::from(&args[2]);
    fs::create_dir_all(&out).expect("out dir");

    let (mut inputs, mut results) = (String::new(), String::new());
    for kind in sorted(&editor.join("fixtures")) {
        for path in sorted(&kind).into_iter().filter(|p| p.extension().is_some_and(|e| e == "json")) {
            let fixture: Value = serde_json::from_str(&fs::read_to_string(&path).expect("reads")).expect("parses");
            let name = format!("{}/{}", kind.file_name().unwrap().to_string_lossy(), path.file_name().unwrap().to_string_lossy());
            let (scope, command) = (fixture["scope"].to_string(), fixture["command"].to_string());
            results.push_str(&format!("{name}\t{}\n", run(&scope, &command)));
            inputs.push_str(&format!("{name}\t{scope}\t{command}\n"));
        }
    }
    // The golden fixtures are ASCII. One extra case carries Indonesian text and
    // non-BMP emoji, which JNI's modified UTF-8 encodes differently.
    let scope = r#"{"mediaAssets":[],"slides":[],"posts":[],"doc":{"schemaVersion":2,"markers":[],"clips":[{"id":"text:1","type":"text","startSec":1,"durationSec":2,"track":0,"note":"Selamat datang di maleo — 🎬✨ naïve café 😀"}]}}"#;
    let command = r#"{"type":"clip.move","id":"text:1","patch":{"startSec":4}}"#;
    results.push_str(&format!("extra/unicode\t{}\n", run(scope, command)));
    inputs.push_str(&format!("extra/unicode\t{scope}\t{command}\n"));
    fs::write(out.join("fixtures.tsv"), &inputs).expect("writes");
    fs::write(out.join("host-results.tsv"), &results).expect("writes");
    println!("fixtures: {}", inputs.lines().count());

    let scope: Value = serde_json::from_str(&fs::read_to_string(editor.join(BENCH_SCOPE)).expect("reads")).expect("parses");
    let clip = &scope["doc"]["clips"][0];
    let start = clip["startSec"].as_f64().expect("startSec");
    let command = serde_json::json!({"type": "clip.move", "id": clip["id"], "patch": {"startSec": start + 0.5}}).to_string();
    let scope = scope.to_string();
    fs::write(out.join("bench.tsv"), format!("{scope}\t{command}\n")).expect("writes");

    let handle = host::open(&scope).expect("opens");
    let mut times = Vec::with_capacity(CALLS);
    let mut next = command.clone();
    let before = spike_live_bytes();
    for _ in 0..CALLS {
        let began = Instant::now();
        next = host::execute(handle, &next).expect("executes");
        times.push(began.elapsed().as_secs_f64() * 1000.0);
    }
    let after = spike_live_bytes();
    times.sort_by(f64::total_cmp);
    let at = |q: f64| times[((times.len() - 1) as f64 * q).round() as usize];
    println!("bench scope {} bytes, command {command}", scope.len());
    println!("host {CALLS} calls: p50={:.4}ms p95={:.4}ms max={:.4}ms", at(0.5), at(0.95), at(1.0));
    println!("host live bytes before={before} after={after} growth={}", after - before);
}
