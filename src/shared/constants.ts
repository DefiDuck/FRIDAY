// ── F.R.I.D.A.Y. Constants ──────────────────────────────────────────────────
// Shared tuning knobs for the pattern engine and UI.

import type { Settings } from './types';

// ── Pattern Engine Thresholds ───────────────────────────────────────────────
/** Minimum occurrences in PATTERN_WINDOW_DAYS to be classified as a pattern. */
export const PATTERN_MIN_OCCURRENCES = 3;
export const PATTERN_WINDOW_DAYS = 14;

/** Minimum occurrences in HABIT_WINDOW_DAYS to be classified as a habit. */
export const HABIT_MIN_OCCURRENCES = 5;
export const HABIT_WINDOW_DAYS = 30;

/** Number of consecutive keyword-absent sessions before streak resets. */
export const STREAK_RESET_THRESHOLD = 5;

// ── Recency Weighting (for pattern salience) ────────────────────────────────
export const RECENCY_WEIGHT_7D = 2.0;
export const RECENCY_WEIGHT_30D = 1.0;
export const RECENCY_WEIGHT_OLDER = 0.5;

// ── Seed Keywords ───────────────────────────────────────────────────────────
// The default vocabulary now lives in src/shared/lexicon.ts (DEFAULT_LEXICON),
// which carries valence + synonym groups per canonical entry. `seedKeywords`
// on Settings is reserved for user-added canonicals on top of that base.
//
// Local LLM enrichment (Ollama) is the second tier — it fills in synonyms
// and idioms the lexicon doesn't know. See src/main/llm-enricher.ts.

// ── Defaults ────────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: Settings = {
  wakeTime: '07:00',
  sessionEndTime: '16:30',
  seedKeywords: [],
  // Default to lexicon-only for fresh installs. The onboarding wizard
  // (Phase 3) asks the user which AI they want and flips this over.
  provider: { type: 'none' },
  onboardingComplete: false,
  launchOnStartup: true,
  showMorningBriefing: true,
  followUpDelayMinutes: 45,
};

// ── Local LLM enrichment ────────────────────────────────────────────────────
/** Default Ollama daemon URL. Override in Settings for non-default ports. */
export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
/**
 * Per-note enrichment timeout. Generous because enrichment runs in the
 * background after save — the user never waits on it. Cold-start on a CPU
 * machine loading a 3-4B model can take 20-30s on the first request;
 * subsequent requests typically return in 5-10s.
 */
export const ENRICHMENT_TIMEOUT_MS = 90_000;
/** Warm-up ping on app start. Short timeout — we don't care if it fails. */
export const WARMUP_TIMEOUT_MS = 30_000;

// ── Window Dimensions ───────────────────────────────────────────────────────
// 420×340 so the titlebar + textarea + footer hint all breathe comfortably.
export const ENTRY_WINDOW_WIDTH = 420;
export const ENTRY_WINDOW_HEIGHT = 340;

// Settings pane — compact column of inputs. v0.1.4 bumped from 440×400
// to 480×560 to match DECISIONS_LOCKED §6.4 modal-width spec and
// eliminate the vertical scrollbar Nino flagged in v0.1.3 testing.
export const SETTINGS_WINDOW_WIDTH = 480;
export const SETTINGS_WINDOW_HEIGHT = 560;

// Onboarding wizard — enough room for the provider cards.
export const ONBOARDING_WIDTH = 540;
export const ONBOARDING_HEIGHT = 560;

// v0.1.5 — Notes List window. Vertically resizable (min 400 / max 900),
// width fixed. Initial size matches the work-order spec §5.1.
export const NOTES_LIST_WIDTH = 480;
export const NOTES_LIST_HEIGHT = 600;
export const NOTES_LIST_MIN_HEIGHT = 400;
export const NOTES_LIST_MAX_HEIGHT = 900;

// v0.1.5 — Pattern Report window. Vertically resizable, width fixed.
export const PATTERN_REPORT_WIDTH = 540;
export const PATTERN_REPORT_HEIGHT = 640;
export const PATTERN_REPORT_MIN_HEIGHT = 400;
export const PATTERN_REPORT_MAX_HEIGHT = 900;

// Briefing card — full-screen modal.  Use 80% of primary display at runtime.
export const BRIEFING_MIN_WIDTH = 520;
export const BRIEFING_MIN_HEIGHT = 420;

// ── App Identity ────────────────────────────────────────────────────────────
export const APP_NAME = 'F.R.I.D.A.Y.';
export const APP_TOOLTIP = 'F.R.I.D.A.Y. — Trader journal';
export const APP_USER_MODEL_ID = 'com.ninov.friday';

// ── Scheduler Labels ────────────────────────────────────────────────────────
export const JOB_WAKE = 'wake';
export const JOB_SESSION_END = 'sessionEnd';
