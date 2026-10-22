# web-pwa-shell Specification

## Purpose

Define installation, static asset delivery, identity, and mobile viewport behavior for the Maleo progressive web application.

## Requirements

### Requirement: The client is installable to a device home screen

The web client SHALL satisfy the browser installability criteria: a linked web app manifest, a registered service worker with a `fetch` handler, and an icon set covering the sizes installers require. The manifest SHALL declare `display: standalone` so a launched install opens without browser chrome, and `orientation: any` so neither portrait nor landscape is refused.

Installability is a conjunction, not a checklist of independent items — a manifest without a service worker, or a service worker without a `fetch` handler, produces no install affordance and no error explaining why.

#### Scenario: An operator adds the app to a home screen

- **WHEN** the client is opened in a browser that supports installation and the operator installs it
- **THEN** the installed entry carries the app's icon and name, and launching it opens the app without a URL bar or browser tab strip

#### Scenario: The install criteria are checked

- **WHEN** a Lighthouse or equivalent installability audit runs against the served client
- **THEN** it reports the manifest as valid, the service worker as registered with a `fetch` handler, and no missing icon size

#### Scenario: The device is rotated

- **WHEN** an installed app is rotated between portrait and landscape
- **THEN** the app follows the rotation rather than being locked to one orientation

### Requirement: PWA assets are served as files, not as the SPA shell

The web server SHALL serve the manifest, the service worker and every icon as static files at their own paths, with the content type each requires — `application/manifest+json` for the manifest, `text/javascript` for the service worker, and the matching image type for icons. These paths SHALL resolve before the SPA catch-all.

The catch-all exists so that client-side routes deep-link correctly. Without explicit routes it also swallows every asset request, and the failure is silent in a way that reads as a manifest authoring bug: the browser receives HTML, fails to parse it as JSON, and reports only that the manifest is invalid.

#### Scenario: The manifest is requested

- **WHEN** the browser fetches the manifest path
- **THEN** it receives the manifest document with a manifest content type, not the HTML shell

#### Scenario: The service worker is requested

- **WHEN** the browser fetches the service worker path during registration
- **THEN** it receives JavaScript with a JavaScript content type, and registration succeeds

#### Scenario: A client route is requested

- **WHEN** the browser requests a path that is neither an api route, an upload, nor a declared PWA asset
- **THEN** the web server still returns the SPA HTML shell

### Requirement: The service worker's scope is installability, not offline

The service worker SHALL be served from the origin root so its default scope covers the whole client. It SHALL NOT cache api responses, upload assets, or media. Its `fetch` handler SHALL pass requests through to the network.

A worker that caches is a worker that can serve stale authenticated data or a stale storyboard, and it persists on a device across deploys. Introducing that behavior is a decision that deserves its own change; introducing the worker to unlock installation does not.

#### Scenario: An api request is issued from the installed app

- **WHEN** the client requests an api route while a service worker is active
- **THEN** the request reaches the network and the response is not served from a cache

#### Scenario: The device is offline

- **WHEN** the installed app is launched with no network
- **THEN** it fails as a network-dependent app fails; offline operation is not claimed

#### Scenario: The worker is updated

- **WHEN** a new version of the service worker is deployed
- **THEN** the worker carries a version identifier that changes, so browsers fetch and activate the new script rather than keeping the installed one indefinitely

### Requirement: Tapping a control does not move the viewport

Interactive controls SHALL render at a font size of at least 16px under `pointer: coarse`. The client SHALL set `touch-action: manipulation` on the document so a double tap does not zoom.

Mobile Safari auto-zooms the viewport whenever focus lands on a control whose font size is under 16px, and does not zoom back out when focus leaves. The client's control styles are 10–14px throughout, so the first tap into any field displaces the layout for the rest of the session. The trigger is the pointer type, not the viewport width: a touch laptop at desktop width zooms, and a desktop browser narrowed to phone width does not.

#### Scenario: An operator taps a text field on a phone

- **WHEN** focus lands on a text input, textarea or select on a coarse-pointer device
- **THEN** the viewport scale is unchanged and the surrounding layout does not shift

#### Scenario: An operator double-taps a control

- **WHEN** two taps land in quick succession on the document
- **THEN** the browser does not zoom, and the control's activation is not delayed waiting to disambiguate the gesture

#### Scenario: The same page is viewed on a desktop pointer

- **WHEN** the client renders on a device reporting a fine pointer
- **THEN** control font sizes are unchanged from their existing values, and the visual baselines do not move

### Requirement: Pinch zoom is suppressed only in an installed app

The viewport declaration SHALL disable user scaling. The client SHALL NOT additionally suppress zoom through scripted gesture handling.

Disabling user scaling fails WCAG 1.4.4, which requires text to be resizable to 200%. Mobile Safari resolves this for us: it has ignored `user-scalable=no` in a browser tab since iOS 10, and honors it inside a standalone install. Declaring it once therefore yields the app-like behavior where the app is installed and leaves the browser tab conformant, without runtime branching on display mode. Adding script-level gesture suppression would defeat that and break the browser-tab case.

#### Scenario: The client is viewed in a browser tab on iOS

- **WHEN** an operator pinches to zoom in a Safari tab
- **THEN** the page zooms, because the platform overrides the declaration

#### Scenario: The client is launched from a home screen install

- **WHEN** an operator pinches inside the installed standalone app
- **THEN** the viewport does not scale, and the app's own layout stays authoritative

#### Scenario: Zoom suppression is implemented

- **WHEN** the client's source is inspected for zoom handling
- **THEN** suppression exists only as the viewport declaration, with no `touchmove`, `gesturestart` or `wheel` handler cancelling zoom gestures

### Requirement: Installed identity uses the Maleo logo and name

The web manifest SHALL declare `name` as `Maleo` and `short_name` as `Maleo`. The app SHALL provide logo-derived PNG icons at 192 and 512 pixels, a separate maskable icon, a browser favicon, and a 180-pixel Apple touch icon. The supplied logo SHALL remain recognizable without stretching or loss caused by device masks. All referenced assets SHALL be served with image content types in development and production, including bundled and stable asset URLs.

#### Scenario: Operator installs Maleo

- **WHEN** an operator installs the app from its manifest
- **THEN** the installation metadata uses Maleo and the supplied bird logo
- **AND** the maskable asset keeps the complete supplied artwork inside its safe region

#### Scenario: Browser or Apple home screen requests an icon

- **WHEN** the browser resolves the favicon or Apple touch icon link
- **THEN** it receives a logo-derived image instead of the former SVG or an HTML fallback

#### Scenario: Existing deployment receives the rebrand

- **WHEN** the new manifest is served at the same origin
- **THEN** manifest `id`, `scope`, and `start_url` remain `/`
- **AND** new icon URLs identify the new assets distinctly from prior icons
- **AND** application acceptance records distinguish served metadata from actual installed-device refresh behavior
