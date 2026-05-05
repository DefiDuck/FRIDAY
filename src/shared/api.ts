// ── IPC Contract between preload bridge and renderer ───────────────────────
// The preload script exposes exactly this object on `window.friday`.
// All six renderers (entry, settings, briefing, onboarding, notes-list,
// pattern-report) share one bridge.

import type {
  Note,
  Settings,
  BriefingPayload,
  SampleBriefingResult,
  NotesListEntry,
  PatternReportPayload,
} from './types';

export interface FridayAPI {
  // ── Notes ─────────────────────────────────────────────────────────────
  saveNote(content: string): Promise<
    | { ok: true; note: Note }
    | { ok: false; error: string }
  >;
  getLastNote(): Promise<Note | null>;
  /**
   * v0.1.5 — return every non-sample note newest-first as a renderer-shaped
   * `NotesListEntry[]`. Surface forms for lexicon markers and AI matches
   * are pre-computed at the IPC boundary so the renderer only has to lay
   * them out. See main.ts → `notes:list-all`.
   */
  listAllNotes(): Promise<NotesListEntry[]>;

  // ── Settings ──────────────────────────────────────────────────────────
  getSettings(): Promise<Settings>;
  updateSettings(partial: Partial<Settings>): Promise<Settings>;

  // ── Briefing ──────────────────────────────────────────────────────────
  getBriefingPayload(): Promise<BriefingPayload>;

  // ── Pattern report (v0.1.5) ───────────────────────────────────────────
  /**
   * Aggregate the user's notes into a `PatternReportPayload` via
   * `computePatterns`. Returns `isEmpty: true` and an empty `patterns`
   * array when fewer than 3 non-sample notes exist; the renderer shows
   * the empty-state copy in that case.
   */
  getPatternReport(): Promise<PatternReportPayload>;

  // ── Provider (onboarding + settings) ──────────────────────────────────
  /** Test whether a provider config is reachable right now. */
  checkProvider(config: Record<string, unknown>): Promise<boolean>;

  // ── Onboarding sample briefing ────────────────────────────────────────
  /**
   * Save the user's first note (with `isSample: true`) and run the
   * lexicon + provider enrichment pipeline against it. Returns within
   * ~12 seconds; falls back to `{ ok: false }` on provider failure.
   * The note is persisted either way.
   */
  generateSampleBriefing(content: string): Promise<SampleBriefingResult>;

  // ── Window control (each renderer can close itself) ───────────────────
  closeWindow(): Promise<void>;
  /** Open (or focus) the note entry window. */
  openEntry(): Promise<void>;
}
