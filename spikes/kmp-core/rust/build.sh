#!/bin/sh
# Builds the native engine for both targets and the host reference run.
# Run before ./gradlew. Uses the rustup toolchain pinned by the repo, which
# carries the iOS and Android targets.
set -eu
cd "$(dirname "$0")"
REPO=$(cd ../../.. && pwd)
TOOLCHAIN=$(rustup show active-toolchain | cut -d' ' -f1)
export PATH="$HOME/.rustup/toolchains/$TOOLCHAIN/bin:$PATH"
NDK_BIN=${ANDROID_NDK_BIN:-$HOME/Library/Android/sdk/ndk/27.3.13750724/toolchains/llvm/prebuilt/darwin-x86_64/bin}
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android24-clang"
export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"

cargo build --release --bin host
cargo build --release --lib --target aarch64-apple-ios-sim
cargo build --release --lib --target aarch64-linux-android

./target/release/host "$REPO/packages/shared/src/editor" ../build/fixtures
mkdir -p ../src/androidMain/jniLibs/arm64-v8a
cp target/aarch64-linux-android/release/libmaleo_kmp_core.so ../src/androidMain/jniLibs/arm64-v8a/
