// ── Pattern Engine ──────────────────────────────────────────────────────────
// Given (notes, lexicon), this module:
//   1. Finds every occurrence of each lexicon synonym inside each note and
//      attributes the hit to the entry's CANONICAL token. So "got back at"
//      and "anger trade" both feed the "revenge" counter.
//   2. Classifies each canonical as 'pattern' (3+ notes in 14d),
//      'habit' (5+ notes in 30d), or unclassified.
//   3. Tracks currentStreak (recent-run length) and longestStreak.
//   4. Provides a matcher for highlighting — returns character-range matches
//      in a single text with overlaps resolved (longer phrase wins) and
//      each match carrying the canonical's valence (negative/positive) so
//      the renderer can paint amber vs green.
//
// Design notes:
//   - One occurrence per note per canonical (not per match). A note that
//     mentions "revenge" and "got back at" still counts as one revenge
//     mention — we're tracking sessions, not word frequency.
//   - Word-boundary regex with a trailing "\w*" tolerates common suffixes
//     ("revenge" matches "revenged", "revenges"). Multi-word phrases
//     ("got back at") require exact boundaries on both sides.
//   - Longest-phrase-wins at match time so "stopped out" claims the range
//     before "stop" can.

import type { Note, PatternEntry, HighlightMatch, Valence } from '../shared/types';
import type { LexiconEntry } from '../shared/lexicon';
import { DEFAULT_LEXICON } from '../shared/lexicon';
import {
  PATTERN_MIN_OCCURRENCES,
  PATTERN_WINDOW_DAYS,
  HABIT_MIN_OCCURRENCES,
  HABIT_WINDOW_DAYS,
  STREAK_RESET_THRESHOLD,
} from '../shared/constants';

const MS_PER_DAY = 86_400_000;

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive regex for a single surface form.
 *   - single word:  \b<kw>\w*\b  (tolerates trailing suffixes)
 *   - phrase:       \b<kw>\b     (exact boundaries on both sides)
 */
function buildSurfaceRegex(surface: string): RegExp {
  const escaped = escapeRegex(surface);
  if (/\s/.test(surface)) {
    return new RegExp(`\\b${escaped}\\b`, 'gi');
  }
  return new RegExp(`\\b${escaped}\\w*\\b`, 'gi');
}

/**
 * Flatten a lexicon into [surface, canonical, valence] tuples for matching.
 * The canonical itself is included as a synonym so a literal "revenge"
 * always matches even if the author forgot to list it explicitly.
 */
interface SurfaceForm {
  surface: string;
  canonical: string;
  valence: Valence;
}

function flattenLexicon(lexicon: readonly LexiconEntry[]): SurfaceForm[] {
  const out: SurfaceForm[] = [];
  const seenForCanonical = new Map<string, Set<string>>();
  for (const entry of lexicon) {
    const canonical = entry.canonical.trim().toLowerCase();
    const seen = seenForCanonical.get(canonical) ?? new Set<string>();
    seenForCanonical.set(canonical, seen);
    // Always include the canonical itself as a matchable surface.
    const candidates = [entry.canonical, ...entry.synonyms];
    for (const raw of candidates) {
      const s = raw.trim().toLowerCase();
      if (s.length === 0) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push({ surface: s, canonical, valence: entry.valence });
    }
  }
  return out;
}

// ── Public: raw match extraction ────────────────────────────────────────────
/**
 * Find non-overlapping matches of any lexicon surface form in `text`.
 * Each match carries the canonical and valence of the entry it came from.
 * Longer surface forms win ties (so "stopped out" wins over "stop").
 */
export interface RawMatch {
  /** Lowercase canonical the match attributes to. */
  canonical: string;
  /** Lowercase surface form that actually matched. */
  surface: string;
  valence: Valence;
  start: number;
  end: number;
}

export function findMatchesInText(
  text: string,
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): RawMatch[] {
  const surfaces = flattenLexicon(lexicon);
  // Longer surfaces first so "stopped out" wins over "stop" at the same start.
  const bySpecificity = [...surfaces].sort((a, b) => b.surface.length - a.surface.length);

  const raw: RawMatch[] = [];
  for (const sf of bySpecificity) {
    const re = buildSurfaceRegex(sf.surface);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      raw.push({
        canonical: sf.canonical,
        surface: sf.surface,
        valence: sf.valence,
        start: m.index,
        end: m.index + m[0].length,
      });
      // Guard against zero-length matches causing infinite loops.
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  // Sort by start asc, then by length desc (longer wins at same start).
  raw.sort((a, b) =>
    a.start - b.start || (b.end - b.start) - (a.end - a.start),
  );
  // Drop any match that overlaps with one we already accepted.
  const out: RawMatch[] = [];
  let cursor = 0;
  for (const m of raw) {
    if (m.start < cursor) continue;
    out.push(m);
    cursor = m.end;
  }
  return out;
}

/**
 * Which canonicals does this note mention (deduped, lowercase)?
 * Used at note-save time to populate Note.keywords.
 */
export function extractKeywords(
  content: string,
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): string[] {
  const hits = new Set<string>();
  for (const m of findMatchesInText(content, lexicon)) {
    hits.add(m.canonical);
  }
  return [...hits];
}

// ── Public: pattern classification across the corpus ───────────────────────
export interface PatternComputation {
  patterns: PatternEntry[];
  /** canonical → classification ('pattern' | 'habit'); unclassified omitted. */
  classifications: Map<string, 'pattern' | 'habit'>;
  /** canonical → valence; built from the lexicon for fast renderer lookup. */
  valences: Map<string, Valence>;
}

interface ComputeOptions {
  now?: number;
}

export function computePatterns(
  notes: Note[],
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
  options: ComputeOptions = {},
): PatternComputation {
  const now = options.now ?? Date.now();
  const surfaces = flattenLexicon(lexicon);

  // canonical → valence map (for storing on PatternEntry without re-scanning).
  const valences = new Map<string, Valence>();
  for (const sf of surfaces) {
    if (!valences.has(sf.canonical)) valences.set(sf.canonical, sf.valence);
  }

  // Pre-build per-surface regexes once; we reuse them across all notes.
  // Sorted longest-first so test() in note-mention pass behaves consistently.
  const compiled: Array<{ canonical: string; re: RegExp }> = surfaces
    .slice()
    .sort((a, b) => b.surface.length - a.surface.length)
    .map((sf) => ({ canonical: sf.canonical, re: buildSurfaceRegex(sf.surface) }));

  // Oldest → newest for streak walks.
  const byTimeAsc = [...notes].sort((a, b) => a.timestamp - b.timestamp);

  // For each note, record which canonicals it mentioned.
  const noteMentions: Array<{ ts: number; canonicals: Set<string> }> = byTimeAsc.map((n) => {
    const mentioned = new Set<string>();
    for (const c of compiled) {
      // RegExp test is stateful for /g, so we rebuild per use.
      if (new RegExp(c.re.source, c.re.flags).test(n.content)) {
        mentioned.add(c.canonical);
      }
    }
    return { ts: n.timestamp, canonicals: mentioned };
  });

  // Flip to per-canonical occurrence lists.
  const occurrences = new Map<string, number[]>();
  for (const nm of noteMentions) {
    for (const canonical of nm.canonicals) {
      if (!occurrences.has(canonical)) occurrences.set(canonical, []);
      occurrences.get(canonical)!.push(nm.ts);
    }
  }

  const patterns: PatternEntry[] = [];
  const classifications = new Map<string, 'pattern' | 'habit'>();

  const windowPatternMs = PATTERN_WINDOW_DAYS * MS_PER_DAY;
  const windowHabitMs = HABIT_WINDOW_DAYS * MS_PER_DAY;

  for (const [canonical, occs] of occurrences.entries()) {
    const count14d = occs.filter((t) => now - t <= windowPatternMs).length;
    const count30d = occs.filter((t) => now - t <= windowHabitMs).length;

    let classification: 'pattern' | 'habit' | null = null;
    if (count30d >= HABIT_MIN_OCCURRENCES) classification = 'habit';
    else if (count14d >= PATTERN_MIN_OCCURRENCES) classification = 'pattern';

    if (classification) classifications.set(canonical, classification);

    // currentStreak: walk newest → oldest, count hits until consecutive misses.
    let currentStreak = 0;
    let missesInARow = 0;
    for (let i = noteMentions.length - 1; i >= 0; i--) {
      if (noteMentions[i]!.canonicals.has(canonical)) {
        currentStreak++;
        missesInARow = 0;
      } else {
        missesInARow++;
        if (missesInARow >= STREAK_RESET_THRESHOLD) break;
      }
    }

    // longestStreak: walk oldest → newest, tracking best run.
    let longestStreak = 0;
    let runHits = 0;
    let misses = 0;
    for (const nm of noteMentions) {
      if (nm.canonicals.has(canonical)) {
        runHits++;
        misses = 0;
        if (runHits > longestStreak) longestStreak = runHits;
      } else {
        misses++;
        if (misses >= STREAK_RESET_THRESHOLD) runHits = 0;
      }
    }

    patterns.push({
      keyword: canonical,
      valence: valences.get(canonical) ?? 'negative',
      occurrences: occs,
      currentStreak,
      longestStreak,
      classification,
      lastSeen: occs[occs.length - 1]!,
    });
  }

  return { patterns, classifications, valences };
}

// ── Public: build briefing highlights for one note ─────────────────────────
/**
 * Returns matches inside `text` for every canonical that is currently
 * classified (pattern/habit). Unclassified canonicals are skipped — we only
 * highlight recurring concepts, not one-off mentions.
 */
export function buildHighlightMatches(
  text: string,
  lexicon: readonly LexiconEntry[],
  patterns: PatternEntry[],
  classifications: Map<string, 'pattern' | 'habit'>,
  now: number = Date.now(),
): HighlightMatch[] {
  if (classifications.size === 0) return [];
  const windowPatternMs = PATTERN_WINDOW_DAYS * MS_PER_DAY;
  const windowHabitMs = HABIT_WINDOW_DAYS * MS_PER_DAY;

  // Restrict scanning to lexicon entries whose canonical reached a tier.
  const relevantEntries = lexicon.filter((e) =>
    classifications.has(e.canonical.toLowerCase()),
  );
  const raw = findMatchesInText(text, relevantEntries);

  const byCanonical = new Map<string, PatternEntry>();
  for (const p of patterns) byCanonical.set(p.keyword, p);

  const result: HighlightMatch[] = [];
  for (const m of raw) {
    const cls = classifications.get(m.canonical);
    if (!cls) continue;
    const entry = byCanonical.get(m.canonical);
    const occs = entry?.occurrences ?? [];
    const count14d = occs.filter((t) => now - t <= windowPatternMs).length;
    const count30d = occs.filter((t) => now - t <= windowHabitMs).length;
    result.push({
      keyword: m.canonical,
      surface: m.surface,
      start: m.start,
      end: m.end,
      classification: cls,
      valence: m.valence,
      count14d,
      count30d,
      source: 'lexicon',
    });
  }
  return result;
}
