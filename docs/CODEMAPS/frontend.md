<!-- Generated: 2026-05-24 | Pages: 11 | Tabs: 25+ | Token estimate: ~500 -->

# Frontend (Dashboard Client)

## Page Tree

| Page       | Size | Purpose                                                                 |
| ---------- | ---- | ----------------------------------------------------------------------- |
| CreatePost | 152K | Draft/post composer, channels, scheduling                               |
| Persona    | 92K  | Main persona editor with tabbed sub-views                               |
| Simulate   | 35K  | Scenario testing + think simulation                                     |
| Composer   | 14K  | Content composition UI                                                  |
| Content    | 18K  | Content-first studio for project brief, references, storyboard versions |
| Journey    | 13K  | User arc visualization                                                  |
| ImageLab   | 12K  | Image generation interface                                              |
| Speech     | 8K   | Gallery of every synthesized clip, filters carried in the URL           |
| SpeechLab  | 6K   | Synthesis session: text, voice picker, character allowance              |
| Inbox      | 12K  | Replies + engagement inbox                                              |
| Overview   | 9K   | Dashboard summary + stats                                               |
| Video      | 9K   | Video generation + rendering                                            |
| Settings   | 5K   | App-level settings                                                      |

## Persona Tabs

Characters, Collections, Voice, Style, Topics, Learning, Thinking,
Posting, Approval, Plugins, Revisions, PersonaMd

## Settings Sub-tabs

ChannelActivationsEditor, ChannelAutomationEditor, ImagePolicyEditor,
VideoPolicyEditor, SecretsPanel

## Shared Tabs

Analytics, Decisions, Evolve, Gates, Learn, Notes, Scenarios, Settings

## Client Architecture

- Entry: `app.tsx` (view-model routing). Each route renders in one shell,
  chosen by `shellFor` (`models/core/shell.ts`):
  - app — workspace sidebar (`components/shell/app-sidebar.tsx`: switcher
    header, nav body, God Mode + version footer) and the top bar
    (`components/shell/top-bar.tsx`: sidebar toggle, breadcrumb, search, credits,
    theme, user menu)
  - god — God Mode sidebar with the same top bar, without credits
  - bare — back control + centered column, for `/account/{profile,security,preferences}`
  - fullscreen — create and the content editor keep their own chrome
- Styling: `styles.css` (global)
- Components: `components/` (shared UI)
- State: local React state (no external store)
- Data fetching: direct fetch via helper functions
