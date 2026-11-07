# One image: API, web UI, media worker, and render worker (with its Rust render host).
#
# They are separate deployables with separate commands, but they are one
# workspace with one lockfile, so three images meant three installs of the same
# 731 packages — run in parallel by the platform, on a host already running
# nine other applications. That failed the build twice with a bare
# `exit code: 1` and no message. One image installs once.
#
# The command is what names the process; see the `command:` on each service in
# deploy/docker-compose.yml.
#
# Built from the REPOSITORY ROOT, because every process depends on workspace
# packages that bun resolves through the root lockfile:
#
#   docker build -t maleo .
#
# The root .dockerignore is what keeps that context at tens of megabytes rather
# than tens of gigabytes; `bun run check:deploy` fails when it grows.

# Pinned to packageManager in package.json: a floating 1.3 tag once pulled a newer
# bun that put the npm `bun` shim (a peer of bun-plugin-tailwind, postinstall
# never run) on PATH and failed `bun run build` with "postinstall script was not run".
# The Rust editor engine's WASM build (crates/), served to the editor at
# /editor-engine.wasm (apps/web/src/app/engine-routes.ts). Its own stage so
# the runtime image carries the module and no Rust toolchain. rust-toolchain.toml
# pins the compiler and the wasm32 target; rustup in this image honours it.
FROM rust:1.98.1-slim AS editor-engine
WORKDIR /src
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY crates crates
COPY vendor vendor
RUN rustup toolchain install && cargo build --locked --release -p maleo-editor-wasm --target wasm32-unknown-unknown

# The renderer's browser module (crates/renderer-wasm, ADR 0011), served to
# the editor's hidden compare mode at /renderer/ (apps/web/src/app/renderer-routes.ts).
# wasm-bindgen writes the module and its JS glue; the CLI must match the
# crate's pinned version.
FROM rust:1.98.1-slim AS renderer-engine
WORKDIR /src
RUN cargo install wasm-bindgen-cli --version 0.2.129 --locked
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY crates crates
COPY vendor vendor
RUN rustup toolchain install \
	&& cargo build --locked --release -p maleo-renderer-wasm --target wasm32-unknown-unknown \
	&& wasm-bindgen --target web --out-dir target/renderer-wasm target/wasm32-unknown-unknown/release/maleo_renderer_wasm.wasm

# The server render host (crates/render-host, OpenSpec p2-export E4). Built on
# bookworm, the runtime base's release, so the binary links against the same
# glibc. Its own Cargo profile: the workspace `release` profile is sized for WASM.
FROM rust:1.98.1-slim-bookworm AS render-host
WORKDIR /src
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY crates crates
COPY vendor vendor
RUN rustup toolchain install \
	&& CARGO_BUILD_JOBS=2 cargo build --locked --profile render-host -p maleo-render-host \
	&& cp target/render-host/maleo-render /usr/local/bin/maleo-render

# FFmpeg for the render host only (OpenSpec p2-export E5): a pinned LGPL shared
# build with OpenH264 for H.264. FFmpeg links against OpenH264 built from the
# same tagged source, then the library is replaced by Cisco's prebuilt binary of
# that version, which carries Cisco's H.264 patent license. The API and media
# worker keep Debian's ffmpeg below. scripts/check-ffmpeg-lgpl.sh fails the
# build if the result is GPL, non-free or lacks libopenh264.
FROM oven/bun:1.3.1 AS ffmpeg-lgpl
ARG FFMPEG_VERSION=7.1.1
ARG FFMPEG_SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
ARG OPENH264_VERSION=2.4.1
ARG OPENH264_SHA256=8ffbe944e74043d0d3fb53d4a2a14c94de71f58dbea6a06d0dc92369542958ea
ARG OPENH264_AMD64_SHA256=ca413853d99d960ebcd5ae5b4c65a85bb2b5598e9042e64700a9f4b737ca3a3f
ARG OPENH264_ARM64_SHA256=cf37063a9f77cf343153e41ef73d3ac05d4825ac6099cd862b1b7799eabf74f2
ARG TARGETARCH
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl xz-utils bzip2 make gcc g++ pkg-config nasm zlib1g-dev \
	&& rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/openh264.tar.gz "https://github.com/cisco/openh264/archive/refs/tags/v${OPENH264_VERSION}.tar.gz" \
	&& echo "${OPENH264_SHA256}  /tmp/openh264.tar.gz" | sha256sum -c - \
	&& mkdir /tmp/openh264 && tar -xzf /tmp/openh264.tar.gz -C /tmp/openh264 --strip-components=1 \
	&& make -C /tmp/openh264 -j2 PREFIX=/opt/ffmpeg-lgpl install-shared \
	&& rm -rf /tmp/openh264 /tmp/openh264.tar.gz
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
	&& echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
	&& mkdir /tmp/ffmpeg && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
	&& cd /tmp/ffmpeg \
	&& PKG_CONFIG_PATH=/opt/ffmpeg-lgpl/lib/pkgconfig ./configure --prefix=/opt/ffmpeg-lgpl \
		--enable-shared --disable-static --disable-doc --disable-debug --disable-ffplay \
		--enable-libopenh264 --extra-ldflags="-Wl,-rpath,/opt/ffmpeg-lgpl/lib" \
	&& make -j2 && make install \
	&& cd / && rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.xz
RUN case "${TARGETARCH}" in \
		amd64) file="libopenh264-${OPENH264_VERSION}-linux64.7.so.bz2"; sum="${OPENH264_AMD64_SHA256}" ;; \
		arm64) file="libopenh264-${OPENH264_VERSION}-linux-arm64.7.so.bz2"; sum="${OPENH264_ARM64_SHA256}" ;; \
		*) echo "no Cisco OpenH264 binary for ${TARGETARCH}" >&2; exit 1 ;; \
	esac \
	&& curl -fsSL -o "/tmp/${file}" "http://ciscobinary.openh264.org/${file}" \
	&& echo "${sum}  /tmp/${file}" | sha256sum -c - \
	&& bunzip2 -c "/tmp/${file}" > "/opt/ffmpeg-lgpl/lib/libopenh264.so.${OPENH264_VERSION}" \
	&& rm "/tmp/${file}" \
	&& rm -rf /opt/ffmpeg-lgpl/include /opt/ffmpeg-lgpl/lib/pkgconfig /opt/ffmpeg-lgpl/share
COPY scripts/check-ffmpeg-lgpl.sh /usr/local/bin/check-ffmpeg-lgpl
# zlib: PNG and zlib-compressed containers decode, as with Debian's ffmpeg.
RUN check-ffmpeg-lgpl /opt/ffmpeg-lgpl/bin/ffmpeg \
	&& /opt/ffmpeg-lgpl/bin/ffmpeg -hide_banner -decoders | grep -q ' png '

# whisper.cpp for local captions, built here so the runtime image needs no git,
# compiler or GitHub access to install it; Settings then fetches only the model.
# Built on the runtime base so the binary links against the same glibc and
# libstdc++. The Makefile takes SIMD flags from the build host's CPU, and the
# platform builds on the host that runs the image. `make main` holds up to
# 1.7.3; later releases build with cmake to build/bin/whisper-cli.
FROM oven/bun:1.3.1 AS whisper
ARG WHISPER_CPP_VERSION=1.5.5
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git make g++ \
	&& git clone --depth 1 --branch "v${WHISPER_CPP_VERSION}" https://github.com/ggerganov/whisper.cpp.git /src \
	&& make -C /src main

# The runtime base with the server render host: the binary, its LGPL FFmpeg
# and Mesa's software Vulkan driver (lavapipe), so export needs no GPU. Its own
# stage so the host can be built and exercised without the workspace install:
#   docker build --target runtime-base -t maleo-render-host .
FROM oven/bun:1.3.1 AS runtime-base
# Lavapipe from bookworm-backports: bookworm's Mesa 22.3 lacks the shader
# float16 capability vello's shaders declare, and refuses them (p2-export 3.3).
RUN echo "deb http://deb.debian.org/debian bookworm-backports main" > /etc/apt/sources.list.d/bookworm-backports.list \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends -t bookworm-backports mesa-vulkan-drivers libvulkan1 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-lgpl /opt/ffmpeg-lgpl /opt/ffmpeg-lgpl
COPY --from=render-host /usr/local/bin/maleo-render /usr/local/bin/maleo-render
ENV MALEO_RENDER_HOST=/usr/local/bin/maleo-render \
	MALEO_FFMPEG=/opt/ffmpeg-lgpl/bin/ffmpeg \
	MALEO_FFPROBE=/opt/ffmpeg-lgpl/bin/ffprobe \
	MALEO_RENDER_H264_ENCODER=libopenh264 \
	WGPU_BACKEND=vulkan
# The binary and its FFmpeg load: a missing job is a reported failure (exit 1), not a crash.
RUN /opt/ffmpeg-lgpl/bin/ffmpeg -hide_banner -encoders | grep -q libopenh264 \
	&& { code=0; maleo-render render --job /nonexistent.json > /dev/null 2>&1 || code=$?; test "$code" -eq 1; }

FROM runtime-base AS runtime
WORKDIR /app

# Dependencies first, from workspace manifests and dependency patches, so a
# source-only change reuses the install layer.
#
# `bun run check:deploy` fails when a workspace manifest is missing from this
# list, because the symptom otherwise is a frozen-lockfile error inside a
# container.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/inngest/package.json packages/inngest/
COPY packages/media/package.json packages/media/
COPY packages/shared/package.json packages/shared/
COPY packages/stock/package.json packages/stock/
COPY packages/storage/package.json packages/storage/
COPY packages/video/package.json packages/video/
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/render-worker/package.json apps/render-worker/
COPY apps/web/package.json apps/web/
COPY patches patches
# The root prepare script installs git hooks; the image has no git checkout.
RUN VP_GIT_HOOKS=0 bun install --frozen-lockfile

# ffmpeg/ffprobe are shelled by API audio-duration, stock music probing, and worker
# for authoritative import probes, thumbnails and playback normalization.
# fonts-noto-color-emoji gives Remotion exports color emoji instead of empty
# boxes. The Rust renderer bundles this package's font file
# (crates/renderer/fonts/NotoColorEmoji.ttf); the golden corpus manifest pins
# its version, so both renderers draw the same glyphs.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-liberation fonts-noto-color-emoji \
		libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 \
		libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 \
		libpango-1.0-0 libcairo2 libcups2 \
	&& rm -rf /var/lib/apt/lists/* \
	&& ffmpeg -version > /dev/null \
	&& ffprobe -version > /dev/null

# Remotion resolves its browser cache from the nearest package.json. Install
# and launch from the same cwd Compose uses; no first-export download.
RUN cd apps/render-worker && bun -e 'import {ensureBrowser, openBrowser} from "@remotion/renderer"; await ensureBrowser(); const browser = await openBrowser("chrome"); await browser.close({silent: true});'

COPY --from=whisper /src/main /opt/whisper.cpp/main

COPY . .

COPY --from=editor-engine /src/target/wasm32-unknown-unknown/release/maleo_editor_wasm.wasm target/wasm32-unknown-unknown/release/maleo_editor_wasm.wasm
RUN bun scripts/optimize-editor-wasm.mts target/wasm32-unknown-unknown/release/maleo_editor_wasm.wasm
COPY --from=renderer-engine /src/target/renderer-wasm target/renderer-wasm
# The preview worker that loads it is TypeScript, bundled with Bun here.
RUN bun scripts/build-renderer-wasm.ts --worker

# Every setting arrives as an environment variable. Nothing reads a repository
# .env file. The API refuses to start in production without
# MALEO_SERVICE_TOKEN, BETTER_AUTH_SECRET, or a reachable media store, naming
# whichever is missing.
#
# MALEO_WEB_HOST matters for the web process: the server defaults to
# 127.0.0.1, which inside a container is reachable only from the container.
ENV NODE_ENV=production \
	MALEO_DATA_DIR=/data \
	MALEO_API_PORT=8090 \
	MALEO_WEB_PORT=3030 \
	MALEO_WEB_HOST=0.0.0.0 \
	MALEO_MEDIA_WORKER_PORT=7071 \
	MALEO_WHISPER_CPP_BIN=/opt/whisper.cpp/main \
	MALEO_WHISPER_CPP_VERSION=1.5.5

# /data holds the unified SQLite database, on the API's service only.
# Single-writer: one replica, and no blue/green, until migrate-to-postgres.
VOLUME ["/data"]
EXPOSE 8090 3030 7071 8091

# No default process: every service names its own command, and an image that
# guessed would start the wrong one.
CMD ["bun", "--version"]
