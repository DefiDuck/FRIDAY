// ── F.R.I.D.A.Y. Shared Type Definitions ────────────────────────────────────
// Data contracts for notes, patterns, and settings.
// The main process, renderer, and pattern engine all agree on these shapes.

import type { Valence } from './lexicon';
export type { Valence } from './lexicon';

/** A single journal entry written by the trader. */
export interface Note {
  /** UUID v4 generated at save time. */
  id: string;
  /** Unix ms of when the note was written. */
  timestamp: number;
  /** Raw markdown text entered by the trader. */
  content: string;
  /**
   * Canonical keywords (from the lexicon) that this note mentioned.
   * Synonyms collapse to their canonical at extract time, so a note that
   * said "got back at the market" stores `['revenge']`.
   */
  keywords: string[];
  /** Optional trading-session date this note refers to (YYYY-MM-DD). */
  sessionDate?: string;
  /**
   * AI enrichment matches computed in the background after save. Cached on
   * the note so we don't re-call the LLM every briefing render. Unset =
   * never enriched (no AI configured, or enrichment failed/skipped).
   */
  enrichmentMatches?: NoteEnrichmentMatch[];
  /** Model tag that produced enrichmentMatches (for cache invalidation). */
  enrichedModel?: string;
  /** Unix ms when enrichment completed. */
  enrichedAt?: number;
  /**
   * True when the note was written via the onboarding "Try It Out"
   * sample-briefing step. Sample notes are persisted (the user invested
   * effort writing them and may want to keep/edit later) but excluded
   * from the real briefing aggregation — see store.getNotesForBriefing
   * and the test in src/main/__tests__/store-briefing-filter.test.ts.
   * Absent on every note written outside onboarding.
   */
  isSample?: boolean;
}

/** A pattern the AI spotted in a single note. Stored on the Note. */
export interface NoteEnrichmentMatch {
  /** Character offset in Note.content. */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Canonical (prefer a lexicon canonical; novel tokens accepted). */
  canonical: string;
  valence: Valence;
  /** Short free-text reason from the model — surfaced in tooltip. */
  rationale?: string;
}

/** A recurring canonical concept tracked across notes. */
export interface PatternEntry {
  /** Canonical token from the lexicon (lowercase). */
  keyword: string;
  /** Whether this concept is a concern (negative) or a strength (positive). */
  valence: Valence;
  /** Timestamps (ms) of every note that mentioned this canonical. */
  occurrences: number[];
  /** Consecutive recent sessions where the canonical appeared. */
  currentStreak: number;
  /** Highest streak ever observed. */
  longestStreak: number;
  /** PATTERN = 3+ in 14d, HABIT = 5+ in 30d, null otherwise. */
  classification: 'pattern' | 'habit' | null;
  /** Unix ms of most recent mention (used for recency weighting). */
  lastSeen: number;
}

/**
 * Branded reference to a secret stored in the OS keychain (Electron's
 * `safeStorage`, backed by DPAPI on Windows / Keychain on macOS).
 * The string itself is not a secret — it is a stable opaque ID like
 * "anthropic-key-7f3a" that lives in store.json and gets resolved to
 * the plaintext key only inside the main process, only at the moment
 * of an outbound API call. The brand prevents accidental swap with
 * plain `string` parameters.
 */
export type KeyRef = string & { readonly __brand: 'KeyRef' };

/**
 * AI provider config as persisted in Settings (store.json). Cloud
 * providers carry a `keyRef` — the actual API key never touches disk
 * in plaintext. The dispatcher in main/providers/index.ts resolves
 * `keyRef → ResolvedProviderConfig` for the duration of one HTTP call.
 *
 * v0.1.1 migration: any v0.1.0 store with a top-level `apiKey: string`
 * field on a cloud provider is rewritten on load — see
 * src/main/secrets/migrate.ts. The `apiKey` field is intentionally
 * absent from this type; the migration tolerates the old shape via
 * structural reads, but new writes can never reintroduce it.
 */
export type StoredProviderConfig =
  | { type: 'none' }
  | { type: 'ollama'; model: string; baseUrl?: string }
  | { type: 'anthropic'; keyRef: KeyRef; model: string }
  | { type: 'openai';   keyRef: KeyRef; model: string }
  | { type: 'gemini';   keyRef: KeyRef; model: string };

/**
 * Used inside main only, never persisted, never crosses IPC. The
 * dispatcher constructs one of these from a StoredProviderConfig +
 * Secrets.get(keyRef) right before calling a per-provider enrich(),
 * then scrubs the local reference in a finally block.
 */
export type ResolvedProviderConfig =
  | { type: 'none' }
  | { type: 'ollama'; model: string; baseUrl?: string }
  | { type: 'anthropic'; apiKey: string; model: string }
  | { type: 'openai';   apiKey: string; model: string }
  | { type: 'gemini';   apiKey: string; model: string };

/** User-facing preferences persisted to store.json. */
export interface Settings {
  /** HH:MM 24h local — morning briefing fires at this time. */
  wakeTime: string;
  /** HH:MM 24h local — session-end reminder fires at this time. */
  sessionEndTime: string;
  /**
   * Deprecated alias for sessionEndTime — kept for stores written by
   * earlier builds (Phase 2 shipped with only `reminderTime`). Reads
   * migrate this into `sessionEndTime` at load time.
   */
  reminderTime?: string;
  /**
   * Deprecated. Pre-provider-refactor field for a single Anthropic key.
   * Retained so old stores load; migrated to `provider` at load time.
   */
  claudeApiKey?: string | null;
  /**
   * Deprecated. Pre-provider-refactor toggle + model. Migrated to
   * `provider: { type: 'ollama', ... }` or `{ type: 'none' }` at load.
   */
  enrichmentEnabled?: boolean;
  enrichmentModel?: string;
  /** User-added canonical keywords on top of the built-in lexicon. */
  seedKeywords: string[];
  /** AI provider choice. `{ type: 'none' }` means lexicon-only. */
  provider: StoredProviderConfig;
  /** Has the user seen the first-run onboarding wizard? */
  onboardingComplete: boolean;
  /**
   * True when the user clicked "Skip for now" on Step 4 (Try It Out)
   * instead of generating a sample briefing. Hint for future re-engagement
   * (offer to generate one from the tray menu). Not used in v0.1.x logic.
   */
  skippedSampleBriefing?: boolean;
  /** Auto-start with Windows. */
  launchOnStartup: boolean;
  /** Show morning briefing on first launch of the day. */
  showMorningBriefing: boolean;
  /** Post-session follow-up notification (minutes after sessionEndTime). */
  followUpDelayMinutes: number;
}

/** One substring in a note that matches a recurring canonical. */
export interface HighlightMatch {
  /** Canonical token from the lexicon (lowercase). */
  keyword: string;
  /** The actual surface form matched (synonym or canonical). */
  surface: string;
  /** Zero-based character index in the note content. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Frequency tier — affects underline weight (dotted vs solid). */
  classification: 'pattern' | 'habit';
  /** Concern (negative) or strength (positive) — affects color. */
  valence: Valence;
  /** How many distinct notes in the last 14 days mentioned this canonical. */
  count14d: number;
  /** How many distinct notes in the last 30 days mentioned this canonical. */
  count30d: number;
  /** 'lexicon' (deterministic match) or 'ai' (model enrichment). */
  source: 'lexicon' | 'ai';
  /** AI-provided reason, when source === 'ai'. */
  rationale?: string;
}

/** One-line footer whisper: "2 concerns · 1 strength watching". */
export interface BriefingSummary {
  /** Distinct negative-valence canonicals currently classified. */
  concernCount: number;
  /** Distinct positive-valence canonicals currently classified. */
  strengthCount: number;
}

/** Payload passed to the briefing renderer. */
export interface BriefingPayload {
  /** Formatted date label (e.g. "Wednesday, April 15"). */
  todayLabel: string;
  /** The most recent note — shown as "yesterday's reflection". */
  lastNote: Note | null;
  /** Matches inside lastNote.content to highlight in-place. */
  lastNoteMatches: HighlightMatch[];
  /** Counts for the footer whisper line. */
  summary: BriefingSummary;
}

// ── v0.1.5: Notes List + Pattern Report payloads ────────────────────────────

/**
 * One row in the v0.1.5 "View all notes" window. Sent main → renderer
 * via the `notes:list-all` IPC channel.
 *
 * `patterns` is synthesised at IPC time — Notes don't carry per-match
 * surface forms for lexicon hits (only `keywords: string[]` of canonicals),
 * so the handler re-scans content with `findMatchesInText` for lexicon
 * markers and slices `content[start..end]` for AI markers from
 * `enrichmentMatches`. Adapt-at-the-boundary, never modify the engine.
 */
export interface NotesListEntry {
  id: string;
  /** Unix ms — matches Note.timestamp; named `createdAt` for renderer clarity. */
  createdAt: number;
  /** First 120 characters of `content`, no ellipsis appended. */
  preview: string;
  /** Full note text — used when the user expands the card. */
  fullText: string;
  /** Sample notes (onboarding "Try It Out") are filtered out by the handler;
      the field is kept for the renderer's tag rendering when sample notes
      are eventually shown (post-beta decision). Always false today. */
  isSample: boolean;
  /** Total markers (lexicon + AI) detected on this note. */
  patternCount: number;
  /** Per-match details for the expanded body. Newest-first not relevant — the
      list reflects character order in the note. */
  patterns: Array<{
    canonical: string;
    valence: Valence;
    /** Verbatim phrase from the note that triggered the marker. */
    matched: string;
    source: 'lexicon' | 'ai';
  }>;
}

/**
 * Aggregated "Pattern report" payload for the v0.1.5 report window.
 * Built at IPC time from `computePatterns(notes, lexicon)` (the engine
 * is not modified; see the handler in `main.ts` for the mapping).
 */
export interface PatternReportPayload {
  /** Unix ms when the IPC handler ran. Renders as the "Generated:" line. */
  generatedAt: number;
  /** Total notes in store including sample notes. */
  totalNotes: number;
  /** Notes the report actually saw (samples filtered out). */
  totalNotesExcludingSample: number;
  /** Window the report covers. Currently locked at 30 days. */
  windowDays: 30;
  /** Per-canonical aggregates, sorted concerns-first then by count30d desc. */
  patterns: PatternReportEntry[];
  /** True when the user has fewer than 3 non-sample notes — the renderer
      shows the "not enough data yet" empty state. */
  isEmpty: boolean;
}

/** One row in PatternReportPayload.patterns. */
export interface PatternReportEntry {
  canonical: string;
  valence: Valence;
  /** Lexicon category (e.g. 'emotional', 'risk'). Defaults to 'mindset' if
      the canonical was AI-invented and isn't in the lexicon. */
  category: string;
  /** Pattern engine returns 'pattern' | 'habit' | null; null is mapped to
      'occasional' here so the renderer can pill it without a null check. */
  classification: 'pattern' | 'habit' | 'occasional';
  /** Distinct notes in last 14 days that mentioned this canonical. */
  count14d: number;
  /** Distinct notes in last 30 days that mentioned this canonical. */
  count30d: number;
  currentStreak: number;
  longestStreak: number;
  /** Unix ms of most recent mention. Null only if `occurrences` was empty
      somehow — should not happen in practice. */
  lastSeenAt: number | null;
  /** Up to 3 verbatim phrases the user wrote that triggered this canonical. */
  sampleMatches: string[];
}

/** Full persisted store shape. */
export interface StoreSchema {
  notes: Note[];
  patterns: PatternEntry[];
  settings: Settings;
  /** Last date (YYYY-MM-DD) the morning briefing was shown. */
  lastBriefingDate: string | null;
}

// ── Onboarding sample-briefing IPC payload ─────────────────────────────────
/** One pattern row rendered in the sample-briefing preview. */
export interface SampleBriefingPattern {
  /** Lexicon canonical (e.g. "revenge") or AI-invented slug. */
  canonical: string;
  /** Concern (negative) or strength (positive). */
  valence: Valence;
  /** Verbatim text from the user's note that triggered the match. */
  matched: string;
  /** Where the match came from — affects the row's icon/legend. */
  source: 'lexicon' | 'ai';
}

/**
 * Result returned by the onboarding sample-briefing IPC. The note is
 * always saved (with `isSample: true`) regardless of branch, so the
 * caller has a noteId either way and the user's writing isn't lost
 * even if the provider chokes.
 */
export type SampleBriefingResult =
  | {
      ok: true;
      noteId: string;
      patterns: SampleBriefingPattern[];
    }
  | {
      ok: false;
      noteId: string;
      error: string;
    };
