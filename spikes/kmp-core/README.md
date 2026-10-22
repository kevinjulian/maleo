# Spike B: Rust core from Kotlin Multiplatform

Question: can one shared Kotlin module call `maleo-editor-core` on Android and
on iOS?

Design: OpenSpec change `platform-p0-foundations` (archived 2026-10-22), decision D3.

## Pass criteria

On an Android emulator and an iOS simulator:

1. The golden editor command fixtures used by
   `crates/editor-core/tests/fixtures.rs` produce byte-identical JSON results
   to the same fixtures run on the host.
2. p50 round-trip latency for one typical edit command is at most 1 ms.
   Record p95.
3. 10,000 sequential calls finish with no crash and no memory growth beyond
   the document size.
4. Record the native library size per target.

## What the spike does

- `rust/` exports the `crates/editor-wasm` calling convention as a native C
  ABI (`engine_alloc`, `engine_open`, `engine_execute`, `engine_read`,
  `engine_close`, the output buffer pair). It reuses `Documents` from
  `maleo-editor-wasm`; that crate's own exports are compiled for `wasm32`
  only. A counting global allocator exposes live Rust heap bytes.
- `rust/src/jni_shim.rs` is the thin JNI shim for Android. Each Kotlin call
  crosses into the C ABI once.
- `src/commonMain` declares `expect object Engine`. `src/iosMain` implements it
  through `cinterop` against `engine.h` and the Rust staticlib. `src/androidMain`
  implements it through the JNI shim and the Rust cdylib.
- `src/commonTest` is one harness that both platforms run:
  - Each of the 59 golden fixtures runs open, execute, read, execute the
    inverse, read, close. The golden fixtures are ASCII, so one extra case
    (`extra/unicode`) carries Indonesian text and non-BMP emoji in an unknown
    clip field, which JNI's modified UTF-8 encodes differently.
    The results (`name, after, inverse, restored`) must equal
    `host-results.tsv` byte for byte. `rust/src/bin/host.rs` writes that file
    by running the same sequence through the same C ABI on macOS.
  - A typical edit, `clip.move` on the first clip of the largest corpus
    project (`corpus/scopes/video-s-0e71d5854634.json`, 17,432 bytes), runs
    1,000 warm-up calls, then 10,000 timed calls. Each call applies the
    previous call's inverse, so the document keeps its size.

## Run

```bash
cd spikes/kmp-core
./rust/build.sh                      # Rust for both targets, host run, fixtures
./gradlew build                      # includes the iOS simulator test
./gradlew connectedAndroidDeviceTest # needs a running emulator
adb logcat -d | grep 'SPIKE\['       # Android measurements
```

`rust/build.sh` uses the rustup toolchain that the repository pins, which has
the iOS and Android targets. It expects NDK 27.3 under
`~/Library/Android/sdk`, or `ANDROID_NDK_BIN`.

## Result

- Date: 2026-10-22, on an Apple M1 Pro.
- Toolchain: Rust 1.98.1, Kotlin 2.4.21, Gradle 9.8.1, Android Gradle Plugin
  9.4.1 (`com.android.kotlin.multiplatform.library`), NDK 27.3, jni 0.21.1,
  Xcode iOS 18.3 SDK.
- Targets: iOS simulator iPhone 16 Pro, iOS 18.3 (`iosSimulatorArm64`).
  Android emulator `Pixel_Fold_API_35`, Android 15, arm64-v8a.
- Binding used: **raw C ABI**, through `cinterop` on iOS and a JNI shim on
  Android. The UniFFI Kotlin Multiplatform generator was not tried, because
  the raw ABI passed every criterion.
- Raw output: `results/`.

| Measure                             | Host (macOS, Rust) | iOS simulator          | Android emulator        |
| ----------------------------------- | ------------------ | ---------------------- | ----------------------- |
| Cases byte-identical to host        | reference          | 60 of 60               | 60 of 60                |
| Result digest (FNV-1a, 175,655 B)   | `3a170358ef391934` | `3a170358ef391934`     | `3a170358ef391934`      |
| Edit round trip p50                 | 0.024 ms           | 0.207 ms               | 0.037 ms                |
| Edit round trip p95                 | 0.026 ms           | 0.250 ms               | 0.077 ms                |
| Edit round trip max                 | 0.794 ms           | 10.4 ms                | 37.0 ms                 |
| 10,000 calls: Rust heap growth      | 2,837 B            | 0 B                    | 0 B                     |
| 10,000 calls: process memory growth | not measured       | -425,984 B (footprint) | -11,120 B (native heap) |
| Native library size (stripped)      | —                  | 775 KB linked          | 831.6 KB `.so`          |

Criteria:

1. **Pass.** All 59 golden fixtures and the extra Unicode case give the same
   bytes as the host on both targets. The JNI string conversion keeps
   non-BMP emoji intact.
2. **Pass.** p50 is 0.207 ms on iOS and 0.037 ms on Android, against a 1 ms
   limit.
3. **Pass.** 10,000 calls with no crash. The Rust heap did not grow on either
   target, and process memory after garbage collection was lower after the
   run than before. The document is 17,432 bytes. `Engine.openCount()`
   returns 0 after each test. The host sample starts at the first call; the device samples follow 1,000 warm-up calls.
4. **Recorded.** iOS: the staticlib file is 22.2 MB because it holds LLVM
   bitcode and all of std. Linked and dead-stripped into a C probe, it adds
   775 KB (791.0 KB against a 16.4 KB empty program). Android: the `.so` is
   831.6 KB.

Notes:

- The iOS test binary is a Kotlin/Native debug build. The Rust code is a
  release build on both targets. On iOS the Kotlin side (UTF-8 encode, pinning,
  copy, decode) accounts for most of the 0.2 ms, against 0.024 ms on the host. A release Kotlin binary will
  be faster.
- The max values are single outliers: a GC pause on iOS, and emulator
  scheduling on Android. p95 is at most 0.25 ms on both.
- Apple's `nm` cannot read the LLVM 22 bitcode in the Rust objects. List the
  exports with `nm -gU --no-llvm-bc`. The Kotlin/Native linker links the
  archive without problems.
- Not run: physical devices, `iosArm64` (device) builds, x86_64 Android, and
  Compose UI on top of the module.

**Verdict: adjust.** Kotlin Multiplatform reaches the core on both platforms,
so grand-plan D4 (mobile is Kotlin Multiplatform) stands. The binding changes:
D4 says "the Rust core reaches Kotlin through generated bindings". The spike
shows that the existing hand-written C ABI is enough. On iOS it is `cinterop`
over one header, and on Android it is a JNI shim of 66 lines. No
generator is needed, and the boundary stays the same calling convention that
the web already uses through WASM.
