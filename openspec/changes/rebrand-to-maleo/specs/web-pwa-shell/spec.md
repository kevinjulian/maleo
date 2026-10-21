# PWA Identity Delta

## ADDED Requirements

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
