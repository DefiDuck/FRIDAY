// ── Shared provider plumbing ────────────────────────────────────────────────
// Every AI provider asks the same question of its model ("find behavioural
// patterns in this trading note, return JSON") and applies the same
// post-processing (locate phrases, validate offsets, sanitize canonicals).
// Extracting that here keeps each provider file small and focused on its
// own transport details (HTTP shape, auth header, response envelope).

import type { NoteEnrichmentMatch, Valence } from '../../shared/types';
import { DEFAULT_LEXICON, findLexiconEntry } from '../../shared/lexicon';

// ── Log redaction ──────────────────────────────────────────────────────────
// Single audit point for any debug output that touches a resolved provider
// config. Per anti-pattern §7.7: any future console.log of `cfg` MUST go
// through redact() — we strip apiKey unconditionally.
export function redact<T extends object>(cfg: T): T {
  const out: Record<string, unknown> = { ...(cfg as Record<string, unknown>) };
  if ('apiKey' in out && typeof out.apiKey === 'string' && out.apiKey.length > 0) {
    out.apiKey = '***REDACTED***';
  }
  return out as T;
}

/**
 * Scrub literal secret substrings out of an error message before it
 * hits console.warn. Required by AC #3 — fetch errors can echo the
 * outbound URL or auth header, and any of those may contain the key.
 * Pass the keys you don't want appearing in logs as the rest args.
 */
export function sanitizeError(message: string, ...secrets: Array<string | undefined>): string {
  let out = String(message);
  for (const s of secrets) {
    if (typeof s === 'string' && s.length >= 8) {
      out = out.split(s).join('[redacted]');
    }
  }
  return out;
}

// ── Prompt ─────────────────────────────────────────────────────────────────
export function buildPrompt(content: string): string {
  const negativeCanonicals = DEFAULT_LEXICON
    .filter((e) => e.valence === 'negative')
    .map((e) => e.canonical)
    .join(', ');
  const positiveCanonicals = DEFAULT_LEXICON
    .filter((e) => e.valence === 'positive')
    .map((e) => e.canonical)
    .join(', ');

  return [
    "You are an expert trading-psychology coach analyzing a trader's journal entry.",
    'Your job is to see BEHAVIOUR, not just words. Traders often mask poor',
    'behaviour with professional language or report positive feelings that are',
    'actually leading indicators of risk. Read the whole note before deciding.',
    'Return valid JSON only.',
    '',
    '── TRADER PSYCHOLOGY ─────────────────────────────────────────────────',
    'The three rules below OUTWEIGH literal word-matching. Apply them first.',
    '',
    '1. THE MASK — Be skeptical of professional-sounding language',
    '   ("high conviction", "stuck to the plan", "followed my process",',
    '   "disciplined entry", "trusted the setup") when it appears after',
    '   losses, confusion, forcing trades, or adding to losers. In that',
    '   context it is RATIONALIZATION, not discipline. Flag as',
    '   `rationalization` (negative), quoting the masked phrase.',
    '   • Clean context → leave it as the positive canonical.',
    '   • Losing/forcing context → flag as rationalization.',
    '',
    '2. THE INVERSE RULE — In trading, high-energy positive emotions are',
    '   often LEADING INDICATORS of risky behaviour. When the trader reports',
    '   euphoric / thrilled / "can\'t wait" / "riding this momentum" feelings',
    '   AND describes aggressive follow-through (sizing up, pyramiding,',
    '   doubling down, skipping their stop, piling on), flag the',
    '   BEHAVIOURAL phrase as `overconfident` (negative) — not the feeling.',
    '   The feeling itself is positive; the pattern it leads to is not.',
    '   If the note is JUST the feeling with no aggressive follow-through,',
    '   leave it as `euphoria` (positive).',
    '',
    '3. THE GAP — When a claimed emotional state contradicts the described',
    '   action, flag `emotional-disconnect` (negative). Quote whichever',
    '   phrase reveals the gap (typically the action). Examples:',
    '     • "I was calm" + "took revenge" → emotional-disconnect',
    '     • "Stayed disciplined" + "doubled down on the loser" → emotional-disconnect',
    '     • "Followed my plan" + "oversized after the first loss" → emotional-disconnect',
    '',
    '── CANONICAL VOCABULARY ──────────────────────────────────────────────',
    'Use one of these for `canonical` whenever possible. Only invent a new',
    'canonical if nothing fits. Invented slugs: short, lowercase, dashed,',
    'ONE concept only (never mash, e.g. not "patient-waited-setup").',
    `  NEGATIVE: ${negativeCanonicals}`,
    `  POSITIVE: ${positiveCanonicals}`,
    '',
    'Mapping hints:',
    '  "got back at" / "payback" / "retaliated" → revenge',
    '  "felt invincible" / "on fire" / "untouchable" / "can\'t lose" → overconfident',
    '  "euphoric" / "thrilled" / "elated" (ALONE) → euphoria',
    '  "euphoric" + aggressive action → overconfident (Rule 2)',
    '  "sized up" / "max size" / "too big" → oversize',
    '  "stayed patient" / "waited" / "held back" → patient',
    '  "stuck to plan" / "followed plan" (CLEAN context) → plan',
    '  "stuck to plan" / "followed plan" (LOSING context) → rationalization (Rule 1)',
    '  "journaled" / "reviewed" / "wrote it down" → journaled',
    '',
    '── OUTPUT SHAPE ──────────────────────────────────────────────────────',
    'For each pattern:',
    '  phrase    — EXACT text from the note, verbatim, no paraphrase',
    '  canonical — one from the vocabulary (preferred), else an invented slug',
    '  valence   — "negative" for concerns, "positive" for strengths',
    '  rationale — 3-10 words on why (include which rule if 1/2/3 applies)',
    '',
    '── EXECUTION RULES ───────────────────────────────────────────────────',
    '  • Only include patterns clearly present in the text.',
    '  • If the trader denies a behaviour ("did NOT revenge trade"), skip it.',
    '  • Skip purely neutral mechanics with no emotional weight ("closed the',
    '    position", "got stopped", "took the trade" — these are events, not',
    '    patterns).',
    '  • Never include a phrase that is not literally in the note.',
    '  • CANONICAL PURITY: the `canonical` field must be EXACTLY one item',
    '    from the vocabulary above, OR a single invented slug representing',
    '    ONE concept. Never concatenate two canonicals ("patientplan",',
    '    "regretaveraged-down" are forbidden). If two canonicals both fit,',
    '    pick the stronger one and emit ONE match.',
    '  • Prefer a known canonical to invention. Only invent when nothing on',
    '    the list plausibly fits.',
    '  • If no patterns, return {"patterns": []}',
    '',
    '── EXAMPLES ──────────────────────────────────────────────────────────',
    '',
    '# Rule 1 (The Mask)',
    'Note: "Lost three in a row. Still had high conviction on the last one — stuck to the plan."',
    'Output:',
    '{"patterns":[',
    '  {"phrase":"high conviction","canonical":"rationalization","valence":"negative","rationale":"Rule 1 — mask over loss streak"},',
    '  {"phrase":"stuck to the plan","canonical":"rationalization","valence":"negative","rationale":"Rule 1 — discipline language after losses"}',
    ']}',
    '',
    '# Rule 3 (The Gap) — positive claim + negative action',
    'Note: "I stayed completely calm today. Took revenge on that ES loss."',
    'Output:',
    '{"patterns":[',
    '  {"phrase":"stayed completely calm","canonical":"calm","valence":"positive","rationale":"self-reported composure"},',
    '  {"phrase":"Took revenge on that ES loss","canonical":"revenge","valence":"negative","rationale":"retaliation trade"},',
    '  {"phrase":"Took revenge on that ES loss","canonical":"emotional-disconnect","valence":"negative","rationale":"Rule 3 — calm claim contradicts revenge action"}',
    ']}',
    '',
    '# Clean — no pattern worth flagging',
    'Note: "Closed the position at target and walked away."',
    'Output: {"patterns":[]}',
    '',
    '# Baseline mix',
    'Note: "FOMO\'d into that NQ scalp, then froze on the exit."',
    'Output:',
    '{"patterns":[',
    '  {"phrase":"FOMO\'d","canonical":"fomo","valence":"negative","rationale":"fear of missing move"},',
    '  {"phrase":"froze on the exit","canonical":"hesitation","valence":"negative","rationale":"could not execute exit"}',
    ']}',
    '',
    '── FINAL GAP-CHECK ───────────────────────────────────────────────────',
    'Before you emit the JSON, re-read the note once more. Ask:',
    '  "Does any positive mindset claim (calm / disciplined / patient /',
    '   followed plan / stuck to process) co-occur with a negative action',
    '   (revenge / doubled down / oversized / averaged down / chased)?"',
    'If yes, ADD an `emotional-disconnect` match quoting the action phrase.',
    'You may emit multiple matches against the same phrase when both a',
    'behavioural canonical (e.g. revenge) and emotional-disconnect apply.',
    '',
    'Now analyse this note:',
    `"""${content}"""`,
    '',
    'Return JSON only.',
  ].join('\n');
}

// ── Response validation ────────────────────────────────────────────────────
interface ModelPattern {
  phrase?: unknown;
  canonical?: unknown;
  valence?: unknown;
  rationale?: unknown;
}
export interface ModelEnvelope {
  patterns?: ModelPattern[];
}

function isValence(x: unknown): x is Valence {
  return x === 'negative' || x === 'positive';
}

function sanitizeCanonical(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

/**
 * Parse a JSON envelope out of a model response. Well-behaved providers
 * return clean JSON; small local models occasionally prefix/suffix stray
 * text — we tolerate that by finding the outer braces.
 */
export function parseEnvelope(raw: string): ModelEnvelope | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as ModelEnvelope;
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as ModelEnvelope;
    } catch {
      return null;
    }
  }
}

/**
 * Locate every occurrence of `phrase` in `content` (case-insensitive,
 * non-overlapping). Used to map the model's quoted phrase back to char
 * offsets — small models can't produce reliable indices themselves.
 */
function locatePhrase(content: string, phrase: string): Array<{ start: number; end: number }> {
  const needle = phrase.trim();
  if (needle.length === 0) return [];
  const haystack = content.toLowerCase();
  const target = needle.toLowerCase();
  const hits: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - target.length) {
    const idx = haystack.indexOf(target, from);
    if (idx === -1) break;
    hits.push({ start: idx, end: idx + target.length });
    from = idx + target.length;
  }
  return hits;
}

/**
 * Convert a validated model envelope into NoteEnrichmentMatch[] anchored
 * to real character offsets in `content`. Drops anything that can't be
 * located verbatim in the note (guards against paraphrasing).
 */
export function envelopeToMatches(
  envelope: ModelEnvelope,
  content: string,
): NoteEnrichmentMatch[] {
  if (!envelope.patterns || !Array.isArray(envelope.patterns)) return [];

  const out: NoteEnrichmentMatch[] = [];
  // Dedupe by (range, canonical) — NOT by range alone. A phrase can
  // legitimately carry two findings: e.g. "Took revenge on that loss" is
  // both a `revenge` pattern AND, if the trader also claimed calm, an
  // `emotional-disconnect` (Rule 3). The renderer currently paints one
  // highlight per range, so overlapping matches beyond the first are
  // silent data on the note — still useful for counts and future UI.
  const claimed = new Set<string>();

  for (const p of envelope.patterns) {
    if (typeof p.phrase !== 'string') continue;
    if (typeof p.canonical !== 'string') continue;
    if (!isValence(p.valence)) continue;

    const canonical = sanitizeCanonical(p.canonical);
    if (canonical.length === 0) continue;

    // Lexicon wins on valence. If the canonical is one we know about
    // (e.g. "euphoria"), the lexicon entry is authoritative — small
    // models sometimes misclassify valence (phi3.5 has called euphoria
    // "positive" because it feels good). For invented canonicals the
    // lexicon has no opinion, so trust the model's self-report.
    const knownEntry = findLexiconEntry(canonical);
    const valence: Valence = knownEntry ? knownEntry.valence : p.valence;

    const rationale =
      typeof p.rationale === 'string' && p.rationale.trim().length > 0
        ? p.rationale.trim().slice(0, 80)
        : undefined;

    for (const loc of locatePhrase(content, p.phrase)) {
      const key = `${loc.start}:${loc.end}:${canonical}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      out.push({
        start: loc.start,
        end: loc.end,
        canonical,
        valence,
        rationale,
      });
    }
  }
  return out;
}
