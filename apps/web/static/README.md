# Client-owned static assets

Files here are served by `src/app/serve.ts` from the **web** origin, at their
own paths, with their own content types. They are not proxied.

That distinction is the whole reason this directory exists. The web server
reverse-proxies `/api/*` and `/uploads/*` to the api, and returns the bundled
SPA shell for everything else. These files are neither: they belong to the
client bundle and are versioned with it, so proxying them to the api would ask
the wrong service for them.

They also cannot ride along inside the bundle. Bun's HTML bundler emits one
module graph rooted at `src/app/index.html`; a manifest is not a module, and a
service worker is a second graph with a different global scope. So each file
here is registered as an explicit route in `serve.ts`, ahead of the `"/*"`
catch-all.

Getting that ordering wrong fails quietly rather than loudly: an unmatched
request falls through to the catch-all and returns the HTML shell with a 200,
so the browser reports "manifest is not valid JSON" rather than "manifest was
not found". If you add a file here, add its route.

## Contents

| File                   | Served as                   | Why it must be at this path                                                                                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.webmanifest` | `application/manifest+json` | Linked from `index.html`; path is free                                                                                                                                |
| `sw.js`                | `text/javascript`           | **Origin root.** A worker's default scope is its own directory, so serving it from a subpath would scope it there and need a `Service-Worker-Allowed` header to widen |
| `maleo-*.png`          | `image/png`                 | Logo source, favicon, Apple touch icon, ordinary and padded maskable install icons.                                                                                   |

`player-licenses.txt` contains the Video.js runtime dependency inventory,
Apache license, MIT license and attribution text. Serve it as UTF-8 plain text at
`/player-licenses.txt`; HTML links this route with `rel="license"`.
Update it when the player dependency closure changes.

## Icons

`maleo-logo.png` preserves the supplied 1254px RGB source. Ordinary icons use 32, 180, 192 and 512px PNG output. `maleo-maskable-512.png` centers the entire source, resized to 280px, on a black 512px canvas. Its corners lie within the maskable safe circle. The logo source and every derivative are listed in root `THIRD_PARTY_NOTICES.md`.

HTML favicon and Apple touch links remain relative bundle inputs. Every stable `/maleo-*.png` URL has an explicit route in `serve.ts`; manifest icons use these stable URLs. Manifest identity, scope and start URL remain `/`. Service worker stays network-only.
