// ── Pattern Report + Notes List IPC builders ────────────────────────────────
// Extracted from main.ts so the test suite can exercise them without
// booting Electron. Same pattern as store-briefing-filter.ts.
//
// These helpers turn raw Notes + the engine's `PatternComputation` into
// the renderer-shaped `NotesListEntry[]` and `PatternReportPayload` per
// the work-order §3 type contracts.
//
// They DO NOT modify the pattern engine — they consume its output as-is
// and adapt to the renderer payload shape (work-order §1 / AC #16).

import type {
  Note,
  NotesListEntry,
  PatternReportEntry,
  PatternReportPayload,
  Valence,
} from '../shared/types';
import type { LexiconEntry } from '../shared/lexicon';
import { DEFAULT_LEXICON } from '../shared/lexicon';
import {
  PATTERN_WINDOW_DAYS,
  HABIT_WINDOW_DAYS,
} from '../shared/constants';
import { findMatchesInText } from './pattern-engine';
import type { PatternComputation } from './pattern-engine';

const MS_PER_DAY = 86_400_000;

// ── Notes List ─────────────────────────────────────────────────────────────

/**
 * Build the renderer payload for one note. Surface forms for lexicon
 * markers come from re-scanning `note.content` with the lexicon (the
 * Note schema only persists canonicals on `keywords[]`); AI markers
 * come from the cached `enrichmentMatches` and resolve their surface
 * via `content.slice(start, end)`.
 *
 * Dedupes lexicon markers by canonical so a note that matches both
 * "revenge" and "got back at" doesn't surface as two rows for the same
 * canonical. AI markers are kept as-is — each is a distinct observation.
 */
export function buildNotesListEntry(
  note: Note,
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): NotesListEntry {
  const seenLexCanonical = new Set<string>();
  const patterns: NotesListEntry['patterns'] = [];

  // Lexicon markers — pick the FIRST surface form per canonical so the
  // popover has a verbatim phrase to show without spamming the body
  // with synonyms of the same concept.
  for (const m of findMatchesInText(note.content, lexicon)) {
    if (seenLexCanonical.has(m.canonical)) continue;
    seenLexCanonical.add(m.canonical);
    patterns.push({
      canonical: m.canonical,
      valence: m.valence,
      matched: note.content.slice(m.start, m.end),
      source: 'lexicon',
    });
  }

  // AI markers — preserve order, slice surface form from content.
  for (const em of note.enrichmentMatches ?? []) {
    patterns.push({
      canonical: em.canonical,
      valence: em.valence,
      matched: note.content.slice(em.start, em.end),
      source: 'ai',
    });
  }

  return {
    id: note.id,
    createdAt: note.timestamp,
    preview: note.content.slice(0, 120),
    fullText: note.content,
    isSample: note.isSample === true,
    patternCount: patterns.length,
    patterns,
  };
}

// ── Pattern Report ─────────────────────────────────────────────────────────

/**
 * Up to 3 distinct verbatim phrases the user wrote that triggered the
 * given canonical. Iterates notes newest-first (caller's responsibility
 * to pre-sort — the function is order-agnostic in correctness, but
 * passing newest-first surfaces the user's recent voice). Dedup is
 * case-sensitive on purpose: "Revenge trade" and "revenge trade" are
 * different evidence for the user.
 *
 * Re-scans note content with the lexicon for lexicon-source matches
 * and reads `enrichmentMatches` for AI-source matches.
 */
export function pickUpTo3Matches(
  notes: Note[],
  canonical: string,
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function add(phrase: string): boolean {
    if (seen.has(phrase)) return false;
    seen.add(phrase);
    out.push(phrase);
    return out.length === 3;
  }

  for (const note of notes) {
    // AI matches first — they're spot observations and tend to capture
    // longer, more interesting phrases ("can't let the loss go") than
    // the lexicon's bare canonical hits.
    for (const em of note.enrichmentMatches ?? []) {
      if (em.canonical !== canonical) continue;
      const phrase = note.content.slice(em.start, em.end).trim();
      if (phrase.length === 0) continue;
      if (add(phrase)) return out;
    }
    // Then lexicon matches.
    for (const m of findMatchesInText(note.content, lexicon)) {
      if (m.canonical !== canonical) continue;
      const phrase = note.content.slice(m.start, m.end).trim();
      if (phrase.length === 0) continue;
      if (add(phrase)) return out;
    }
  }
  return out;
}

/** Look up the lexicon category for a canonical; defaults to 'mindset'
 *  for AI-invented canonicals that don't appear in the lexicon. */
function categoryFor(
  canonical: string,
  lexicon: readonly LexiconEntry[],
): string {
  const entry = lexicon.find(
    (e) => e.canonical.toLowerCase() === canonical.toLowerCase(),
  );
  return entry?.category ?? 'mindset';
}

/**
 * Build the full `PatternReportPayload` from a fresh `computePatterns`
 * result. The handler in main.ts calls this; tests construct fake
 * inputs and assert payload shape directly.
 *
 * Empty-state rule: when fewer than 3 non-sample notes exist, return
 * `isEmpty: true` and an empty patterns array (work-order §4.2).
 */
export function buildPatternReportPayload(
  notes: Note[],
  computation: PatternComputation | null,
  totalNotesIncludingSamples: number,
  now: number = Date.now(),
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): PatternReportPayload {
  if (notes.length < 3 || computation === null) {
    return {
      generatedAt: now,
      totalNotes: totalNotesIncludingSamples,
      totalNotesExcludingSample: notes.length,
      windowDays: 30,
      patterns: [],
      isEmpty: true,
    };
  }

  const windowPatternMs = PATTERN_WINDOW_DAYS * MS_PER_DAY;
  const windowHabitMs = HABIT_WINDOW_DAYS * MS_PER_DAY;

  const patterns: PatternReportEntry[] = computation.patterns.map((p) => {
    const count14d = p.occurrences.filter((t) => now - t <= windowPatternMs).length;
    const count30d = p.occurrences.filter((t) => now - t <= windowHabitMs).length;
    const classification: PatternReportEntry['classification'] =
      p.classification ?? 'occasional';
    return {
      canonical: p.keyword,
      valence: p.valence as Valence,
      category: categoryFor(p.keyword, lexicon),
      classification,
      count14d,
      count30d,
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      lastSeenAt: p.lastSeen,
      sampleMatches: pickUpTo3Matches(notes, p.keyword, lexicon),
    };
  });

  return {
    generatedAt: now,
    totalNotes: totalNotesIncludingSamples,
    totalNotesExcludingSample: notes.length,
    windowDays: 30,
    patterns,
    isEmpty: false,
  };
}
