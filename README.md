# F.R.I.D.A.Y.

**F**ocus · **R**eview · **I**ntelligence · **D**aily · **A**nalysis · **Y**ield

A Windows tray journal for traders. Sticky note app fine-tuned to trading psychology: end of day you write what happened, next morning F.R.I.D.A.Y. reminds you what you did yesterday and flags the patterns. Revenge entries, FOMO chases, the lies you tell yourself when you blow up a setup.

Status: pre-beta. Closed beta launches after v0.1.6.

## Stack

- Electron 30
- TypeScript (strict, two `tsc` projects — main + renderer)
- Vanilla TS renderers, no framework
- Custom JSON store with atomic write
- Discriminated-union AI provider dispatcher (Ollama / Anthropic / OpenAI / Gemini / None)
- API keys encrypted via Electron `safeStorage` (DPAPI on Windows)
- No telemetry, no analytics, no CDN font loads

## Run

```
npm install
npm run start
```

`npm run start` builds and launches Electron. Use `npm run dev` for dev mode (passes `--dev` flag).

## Build & test

```
npm run build       # tsc main + renderer + copy assets
npm run test        # node --test against compiled tests in dist/
npm run clean       # rimraf dist
```

22 tests across:

- `dist/main/secrets/__tests__/secrets.test.js` — secrets module + safeStorage migration
- `dist/main/__tests__/store-briefing-filter.test.js` — sample-note exclusion from briefing
- `dist/main/__tests__/pattern-report-helpers.test.js` — pattern report aggregation + sample-match dedupe

## Repo layout

```
src/
  main/                    Electron main process
    main.ts                tray + IPC dispatch + window factories
    store.ts               atomic JSON persistence (store.json)
    scheduler.ts           cron jobs for wake / session-end
    pattern-engine.ts      lexicon match + pattern/habit classification
    preload.ts             contextBridge for renderer
    providers/             AI provider dispatcher (ollama, anthropic, openai, gemini, none)
    secrets/               safeStorage wrapper + plaintext-key migration
    briefing-filter.ts     sample-note exclusion (used by briefing + report)
    pattern-report-helpers.ts   engine output → renderer payload
    notes-list-window.ts   BrowserWindow factory
    pattern-report-window.ts    BrowserWindow factory

  renderer/                Four BrowserWindows (vanilla TS + plain HTML/CSS)
    entry/                 daily note input
    briefing/              morning briefing card
    settings/              preferences panel
    onboarding/            4-step first-launch wizard
    notes-list/            full chronological note list
    pattern-report/        aggregated pattern view
    shared/                tokens.css, base.css, animations.css, popover.css, popover.ts, fonts/

  shared/                  types + constants + lexicon + IPC API contract

assets/                    icons + future tray-icon variants
scripts/                   build helpers (copy-assets, smoke tests)
```

## Phase status

| Version  | Phase                              | Status |
|----------|------------------------------------|--------|
| v0.1.0   | Lexicon + Hybrid AI + Onboarding   | shipped |
| v0.1.1   | safeStorage migration              | shipped |
| v0.1.2   | Onboarding sample briefing         | shipped |
| v0.1.3   | Visual consistency pass            | shipped |
| v0.1.4   | Premium polish (popover + animations + bundled fonts) | shipped |
| v0.1.5   | View All Notes + Pattern Report    | shipped |
| v0.1.5.1 | Zero-friction onboarding default   | queued |
| v0.1.6   | Closed-beta build pipeline (NSIS)  | queued |
| v0.2.0   | Settings UI + provider hot-swap    | post-beta |
| v0.2.1   | Tray dual-UI + Alt+F hotkey        | post-beta |
| v0.3.0   | Lemon Squeezy + entitlements       | post-beta |
| v0.4.0   | Signed installer + auto-update     | public-launch |

## Architecture & decisions

The Strategic Review, Work Orders, locked UX decisions, and the Gemini Deep Research output live OUTSIDE the repo at `C:\Users\ninov\Desktop\Research-Phase\` — design intent stays separate from source.

The most important architectural reference is `DECISIONS_LOCKED_FRIDAY_UX.md` (canonical UX decisions, design tokens, anti-patterns). Read it.

## Running tests during development

```
npm run test
```

If the `node --test` invocation can't find a test file, the cause is almost always that `npm run build:main` skipped a TS file due to a compile error somewhere in the tree. Fix the compile error, the test path resolves.

## Privacy

Nothing leaves your machine unless you choose a cloud AI provider during onboarding, and even then, only the note text goes to that provider. No telemetry. No analytics. API keys are encrypted via Windows DPAPI (`safeStorage`) and never logged.

## License

See [LICENSE](LICENSE).

---

Repo is private. Do not redistribute the source or the unsigned beta installers.
