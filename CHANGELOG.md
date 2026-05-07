# Changelog

All notable changes to F.R.I.D.A.Y. are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Phases up to and including `v0.1.5` were imported as a single baseline commit
(see the `v0.1.5` tag). From that tag forward, every change lands as one or
more atomic commits — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the
convention.

## [Unreleased]

_Nothing yet — `v0.1.6` (closed-beta build) is the next planned release._

## [0.1.5] — 2026-05-05

### Added
- **View all notes** tray-menu window: chronological list of every non-sample note,
  click-to-expand cards with full text and pattern markers, popover wired on the
  inline markers via the shared `attachPopover` helper.
- **Pattern report** tray-menu window: aggregates `computePatterns` output into
  concerns / strengths groups with classification pills (Pattern / Habit /
  Occasional), 14- / 30-day counts, current and longest streaks, last-seen
  timestamp, and up to three sample matches per canonical. Refresh button
  re-runs the aggregation.
- New main-process IPC handlers `notes:list-all` and `pattern:report` exposed via
  `window.friday.listAllNotes()` / `window.friday.getPatternReport()`.
- New helpers `pickUpTo3Matches`, `briefingFilter`, and the
  `pattern-report-helpers` module with their own unit tests
  (`src/main/__tests__/pattern-report-helpers.test.ts`).

### Notes
- The pattern engine itself (`src/main/pattern-engine.ts`) was **not** modified;
  shape adaptation happens at the IPC boundary so the algorithm stays a single
  source of truth.

## [0.1.4] — 2026-04-29

### Added
- Custom popover component (`src/renderer/shared/popover.{ts,css}`) replacing
  every browser-default `title` tooltip. Hover-open after 300 ms, click-toggle,
  Esc / outside-click dismiss, single-instance rule, auto-flip near viewport
  edges. Vanilla TS, no third-party deps.
- Animation tokens split into `--dur-*` × `--ease-*` per `DECISIONS_LOCKED §11.1`.
- `src/renderer/shared/animations.css` with button press feedback, modal entry,
  toast entry, and a `prefers-reduced-motion` block.
- Bundled webfonts: Inter Variable + IBM Plex Mono Regular/Medium as woff2
  under `src/renderer/shared/fonts/` (~440 KB total). `local()` first,
  bundled `url()` fallback. No CDN — privacy stance is local-first.
- Native-element font hardening for `select / time / number / date` inputs.

### Changed
- Settings window bumped from 440×400 to 480×560 with `useContentSize: true` —
  no more vertical scrollbar on a 1366×768 laptop.
- Briefing pattern markers now carry `data-canonical / data-valence / data-summary
  / data-source / data-frequency / data-window` attributes; `attachPopover`
  builds the popover content lazily on each show.
- All four windows declare `font-src 'self'` in their CSP for explicitness.

### Fixed
- Font drift on Windows machines without Inter installed — bundled fonts
  guarantee the locked typeface always renders.

## [0.1.3] — 2026-04-28

### Added
- Single source of truth for design tokens: `src/renderer/shared/tokens.css`
  (palette, typography, spacing, radii, easing curves) per
  `DECISIONS_LOCKED §6.2 / §6.3 / §6.4 / §6.5 / §6.6`.
- Shared base styles: `src/renderer/shared/base.css` paints the Odysseus-Teal
  radial gradient backdrop (§6.6), declares fonts, and provides shared button /
  input / card / pill / scrollbar styles.
- Welcome screen body copy from `DECISIONS_LOCKED §7.1`:
  > Friday spots the patterns you can't see in the moment. The revenge
  > entries, the chases, the setups you talked yourself out of. Friday
  > knows. Friday is watching...

### Changed
- All four renderers (entry, briefing, settings, onboarding) link
  `../shared/base.css` and reference tokens via `var(--*)` — no hex literals
  outside `tokens.css`, no font-family literals outside `base.css`'s
  `@font-face` blocks.

## [0.1.2] — 2026-04-28

### Added
- Onboarding wizard step 4: **Try It Out** — the user types a note and gets a
  real sample briefing back, generated through the same lexicon + provider
  enrichment pipeline used in production.
- `Note.isSample` field; sample notes persist (the user invested effort) but are
  excluded from the real briefing aggregation via `briefingFilter`.
- New IPC handler `onboarding:generate-sample-briefing`.

### Fixed
- Closed the asynchronous-value gap that was the largest retention risk in the
  product — first-run users see Friday's value before they ever close the
  wizard.

## [0.1.1] — 2026-04-26

### Security
- **Plaintext API keys are gone from `store.json`.** New `src/main/secrets/`
  module wraps Electron's `safeStorage` (DPAPI on Windows / Keychain on macOS).
  The store now holds only opaque `keyRef` strings; the encrypted blobs live in
  a sibling `secrets.bin` file written atomically.
- One-shot migration on load: any v0.1.0 store with a top-level
  `provider.apiKey` is encrypted into `secrets.bin` and the plaintext field is
  removed before `Store.load()` returns. Idempotent.
- Dispatcher resolves `keyRef → plaintext` only for the duration of one HTTP
  call, then scrubs the local reference in a `finally` block.
- Log redaction (`redact()`, `sanitizeError()`) added in `providers/shared.ts`;
  the cloud-provider catch blocks now route `err.message` through the scrubber
  before it hits `console.warn`.

## [0.1.0] — 2026-04-15

### Added
- Initial Electron 30 + TypeScript tray journal app.
- Daily note entry with `Ctrl+Enter` save / `Esc` discard.
- Morning briefing with last reflection + recurring-pattern markers.
- Settings panel for wake / session-end times + launch-on-startup.
- Lexicon-based pattern engine (`src/main/pattern-engine.ts`) that detects
  trader-psychology concepts (revenge, FOMO, tilt, discipline, etc.) and
  classifies them as Pattern (3+ in 14d) or Habit (5+ in 30d).
- Provider-agnostic AI enrichment dispatcher (`src/main/providers/`) supporting
  Ollama / Claude / OpenAI / Gemini / lexicon-only.
- Three-screen onboarding wizard (Welcome / Choose AI / Provider Setup).
- Atomic JSON store (`src/main/store.ts`) with schema migrations.

[Unreleased]: https://github.com/DefiDuck/FRIDAY/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.5
[0.1.4]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.4
[0.1.3]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.3
[0.1.2]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.2
[0.1.1]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.1
[0.1.0]: https://github.com/DefiDuck/FRIDAY/releases/tag/v0.1.0
