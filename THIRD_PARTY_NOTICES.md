# Third-party notices

Maleo's original source code and repo-authored assets are licensed under the
MIT License. That license does not replace licenses or terms attached to
dependencies, models, container images, provider APIs, or media returned by a
provider. This inventory was reviewed on 2026-09-08 and is not legal advice. The
Inngest entries were corrected on 2026-09-21: the SDK and the self-hosted server
carry different licenses.

## Direct runtime dependencies

Versions are pinned by `bun.lock`; links below point to upstream license files
or package sources. Transitive dependencies retain their own notices.

| Dependency                                                     | Declared license                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Hono and `@hono/node-server`                                   | MIT                                                                                             |
| `better-auth`                                                  | MIT                                                                                             |
| React, React DOM, Radix UI, React Colorful, Zod, html-to-image | MIT                                                                                             |
| `@huggingface/inference`, `@modelcontextprotocol/sdk`          | MIT                                                                                             |
| Inngest SDK (`inngest`) and Sharp                              | Apache-2.0                                                                                      |
| Mediabunny                                                     | MPL-2.0                                                                                         |
| YAML and zod-to-json-schema                                    | ISC                                                                                             |
| Remotion packages                                              | Mixed MIT and [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) |

Remotion is not uniformly MIT. Several packages, including renderer, bundler,
CLI, player, Lambda, Google Fonts integration, and Whisper installer, declare
the Remotion License. Its company-size and use limits may require a paid license;
review current terms before commercial deployment. Packages declaring MIT keep
their MIT terms.

## Vendored Rust shader correction

`vendor/vello_shaders` retains `vello_shaders` 0.11.0 from the Vello Authors,
licensed under Apache-2.0 OR MIT. Both upstream license texts remain in that
directory. Maleo modifies the medium-quality bilinear sampling branch of
`shader/fine.wgsl` to compute fractions before adding atlas offsets and accumulate
analytic area in geometry order. An opt-in raw image-quality mode reproduces
Skia's four-bit premultiplied-byte source sampling; GPU treatment images retain
standard filtering. Pixel presentations and solid effect plates opt into
byte-opacity composition; ordinary blend groups retain Vello arithmetic.
Shader and CPU coarse paths keep sixteen blend levels inline to avoid the
fixed spill-buffer limit for supported compositor trees. Cargo uses
the same corrected source for native and WASM builds. Source revision, registry
checksum, changed-file hashes and replacement criteria are recorded in
`vendor/vello_shaders/MALEO_PATCH.md`.

## Models and container images

| Item                                                                                                            | Terms                                                               | How used                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M/blob/4d240409f7eed58ba22a40e921be104b0ef9f958/README.md) | Apache-2.0 model                                                    | Pulled inside pinned `remsky/kokoro-fastapi-cpu` image; model and image keep upstream terms.                                              |
| [SearXNG](https://github.com/searxng/searxng/blob/master/LICENSE)                                               | AGPL-3.0-or-later                                                   | Pinned service image used for self-hosted search.                                                                                         |
| [Crawl4AI](https://github.com/unclecode/crawl4ai/blob/main/LICENSE)                                             | Apache-2.0                                                          | Pinned service image used for self-hosted page extraction.                                                                                |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)                                      | MIT                                                                 | Optional local caption alignment install. Downloaded model files retain their source terms.                                               |
| [Inngest server](https://github.com/inngest/inngest/blob/main/LICENSE.md)                                       | SSPL-1.0, with a grant of Apache-2.0 three years after each release | Pinned `inngest/inngest` image used for self-hosted durable execution. Not a `bun.lock` dependency.                                       |
| [RustFS](https://github.com/rustfs/rustfs/blob/main/LICENSE)                                                    | Apache-2.0                                                          | Container image used for optional self-hosted media storage. Replaced MinIO, whose community images were withdrawn from their registries. |

## Render host media libraries

The render worker's Rust render host (`maleo-render`, OpenSpec `p2-export`) runs
these through separate processes or system packages. None is linked into the
Maleo source.

| Item                                                                    | Terms                                                                     | How used                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FFmpeg 7.1.1](https://ffmpeg.org/legal.html)                           | LGPL-2.1-or-later (built without `--enable-gpl` and `--enable-nonfree`)   | Built from the pinned release tarball (SHA-256 in the `Dockerfile` `ffmpeg-lgpl` stage) as shared libraries under `/opt/ffmpeg-lgpl`. The host runs `ffmpeg`/`ffprobe` as child processes. `scripts/check-ffmpeg-lgpl.sh` fails the image build if the build is GPL, non-free or lacks OpenH264. The source is the tarball named in the `Dockerfile`, and the configure line is printed by `ffmpeg -buildconf`. The API and media worker use Debian's separate `ffmpeg` package. |
| [OpenH264 2.4.1](https://github.com/cisco/openh264/blob/master/LICENSE) | BSD-2-Clause. The H.264 patent license comes from Cisco's prebuilt binary | FFmpeg builds against the headers of the tagged source. At runtime the library is Cisco's prebuilt `libopenh264` 2.4.1 binary for the image architecture, downloaded from `ciscobinary.openh264.org` and pinned by SHA-256. "OpenH264 Video Codec provided by Cisco Systems, Inc."                                                                                                                                                                                               |
| [Mesa lavapipe](https://docs.mesa3d.org/license.html)                   | MIT                                                                       | Debian `mesa-vulkan-drivers`: the software Vulkan device the host renders on.                                                                                                                                                                                                                                                                                                                                                                                                    |

The Inngest **SDK** (the `inngest` npm package listed above) is Apache-2.0. The
Inngest **server** is not: the image an operator deploys is under the Server Side
Public License 1.0. SSPL section 13 attaches obligations to making the program's
functionality available to third parties as a service; Inngest's published cloud
terms do not address self-hosting or this license. Operators offering a hosted
service built on a self-hosted Inngest server should review SSPL section 13 for
themselves, or use Inngest's commercial cloud, which the SSPL does not reach.

## Fonts and repo assets

- Web UI requests [Space Grotesk](https://github.com/floriankarsten/space-grotesk/blob/master/OFL.txt)
  and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt)
  from Google Fonts. Both use SIL Open Font License 1.1. Font files are not
  committed here; Google Fonts requests remain subject to Google's terms and
  privacy practices.
- `apps/web/static/maleo-logo.png` is the operator-supplied Maleo logo, copied unchanged from the supplied `malo-logo.png`. It is first-party brand artwork, not an upstream dependency. The source does not supply separate third-party attribution.
- `apps/web/static/maleo-favicon-32.png`, `apps/web/static/maleo-apple-touch-180.png`, `apps/web/static/maleo-icon-192.png`, `apps/web/static/maleo-icon-512.png`, and `apps/web/static/maleo-maskable-512.png` are deterministic PNG derivatives of that logo. Ordinary sizes use Lanczos resizing; the maskable variant places a 280px image inside a 512px black canvas. No additional artwork was generated.

- `apps/web/visual/baselines/*.png` are generated screenshots of Maleo's own UI
  and are distributed under MIT with repository source.
- `crates/renderer/corpus/` holds the Rust renderer's golden corpus: Remotion
  renders of Maleo's own compositions, and synthetic media generated for it
  (gradients, grids and discs, no photographs). Both are distributed under MIT
  with repository source.
- `crates/renderer/assets/grain.rgba` is a production-browser raster of Maleo's
  constant SVG noise tile, distributed under MIT with its source. Its recipe
  and hash are in `crates/renderer/assets/README.md`.
- The Rust renderer bundles its fonts (`crates/renderer/fonts/`), all under the
  SIL Open Font License 1.1, with the license text beside them:
  - [Inter](https://github.com/rsms/inter) v20, the files `@remotion/google-fonts`
    serves (`Inter-OFL.txt`): `crates/renderer/fonts/inter-normal-latin.ttf`,
    `crates/renderer/fonts/inter-normal-latin-ext.ttf`,
    `crates/renderer/fonts/inter-italic-latin.ttf` and
    `crates/renderer/fonts/inter-italic-latin-ext.ttf`.
  - [Noto Color Emoji](https://github.com/googlefonts/noto-emoji)
    (`NotoColorEmoji-OFL.txt`): `crates/renderer/fonts/NotoColorEmoji.ttf`,
    unchanged from Debian `fonts-noto-color-emoji` 2.042-0+deb12u1, the
    package the production image installs.
- Repository contains no other tracked font files, and no audio, stock media,
  generated video, or customer sample media. Runtime-generated and provider-returned media
  are not covered by Maleo's MIT grant; operators must retain and follow their
  source terms.

## Provider APIs and returned content

- [Pexels API terms and attribution requirements](https://www.pexels.com/api/documentation/)
  apply to searches and returned assets. Keep provider and creator links.
- [Freesound API terms](https://freesound.org/help/tos_api/) and each sound's
  own license apply. Commercial use stays disabled until operator explicitly
  confirms permission, but that confirmation does not replace per-sound review.
- Cloudflare Workers AI, Hugging Face Inference Providers, OpenAI-compatible
  endpoints, Codex CLI, Claude CLI, and any configured remote provider retain
  their own service and content terms.

See `PRIVACY.md` for data sent to configured providers.

## Video.js export player

The web app pins `@videojs/react` 10.0.1. Its required Video.js runtime packages
(core, media, native-hls-video, spf, store, utils) and `signal-polyfill` use
Apache-2.0. React, React DOM, Scheduler and `react-compiler-runtime` use MIT.
The installed closure was reviewed on 2026-10-20. No optional analytics,
casting or hosting adapters are enabled. Player code and CSS are bundled locally.

The web distribution serves the full Apache and MIT licenses and applicable
Video.js copyright/trademark text at `/player-licenses.txt`, sourced from
[the shipped player notices](apps/web/static/player-licenses.txt). The HTML
license link makes them discoverable, and the stable route serves them in
both development and production. Upgrades must recheck the installed closure
and update these notices. Mark modified upstream files if an upgrade requires
editing upstream source; the current integration does not modify those modules.
The Apache license does not require a visible player logo or source disclosure
for Maleo. This dependency review does not cover other SaaS dependencies,
content rights or media-codec licensing.
