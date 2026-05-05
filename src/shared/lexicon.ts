// ── F.R.I.D.A.Y. Trader Lexicon ─────────────────────────────────────────────
// The structured replacement for the old flat seed-keyword list.
//
// Each entry collapses many surface forms ("got back at", "anger trade",
// "vengeance") onto a single canonical word ("revenge").  The pattern engine
// matches any synonym but attributes the occurrence to the canonical, so a
// trader who writes about "tilted hard" on Monday and "got rattled" on
// Tuesday accumulates one streak under the same root concept.
//
// ──────────────────────────────────────────────────────────────────────────
//
// Synonym authoring rules:
//   • Prefer the shortest grammatically valid root.  The engine appends `\w*`
//     to single-word entries, so "patient" already matches "patiently" and
//     "patience" — no need to list every inflection.
//   • Multi-word phrases are matched verbatim (with word boundaries on both
//     ends), so use them to capture idioms like "got back at" or "stuck to
//     plan" that single-word matching can't see.
//   • Avoid synonyms that overlap with another entry's canonical.  At match
//     time, longer phrases win, so "stopped out" can safely coexist with
//     "stop" — but "discipline" listed under both "discipline" and "process"
//     would double-count.
//
// Valence:
//   • 'negative'  — concerns, drawn in amber.  Recurring negatives are
//                   what we want the trader to notice.
//   • 'positive'  — disciplines, drawn in green.  Recurring positives
//                   reinforce the behaviour we want to keep.
//
// Categories are advisory only — used by future report views to group
// related entries ("emotional", "process", "execution").  The engine itself
// doesn't read them.
//
// Long-tail / contextual matches (e.g. "I did NOT revenge trade", or novel
// idioms not in the dictionary) are the job of the optional Claude enricher
// — see src/main/claude-enricher.ts.

export type Valence = 'negative' | 'positive';

export type LexiconCategory =
  | 'emotional'
  | 'process'
  | 'execution'
  | 'risk'
  | 'mindset';

export interface LexiconEntry {
  /** Canonical token stored in note.keywords and used as the pattern key. */
  canonical: string;
  valence: Valence;
  category: LexiconCategory;
  /**
   * All surface forms (including the canonical itself, if you want it
   * matched literally — single-word canonicals already match via `\w*`,
   * so listing them again is usually unnecessary).
   *
   * Order doesn't matter; the engine sorts by length at match time so the
   * most specific phrase wins.
   */
  synonyms: readonly string[];
}

// ── Negative — emotional and behavioural concerns ──────────────────────────
const NEGATIVE: readonly LexiconEntry[] = [
  {
    canonical: 'revenge',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['revenge', 'got back at', 'anger trade', 'vengeance', 'payback', 'chased the loss'],
  },
  {
    canonical: 'fomo',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['fomo', 'fear of missing', 'missing out', 'had to get in', 'didn\u2019t want to miss', 'didnt want to miss'],
  },
  {
    canonical: 'tilt',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['tilt', 'tilted', 'on tilt', 'lost control', 'rattled', 'shaken'],
  },
  {
    canonical: 'overtrade',
    valence: 'negative',
    category: 'execution',
    synonyms: ['overtrade', 'too many trades', 'kept trading', 'couldn\u2019t stop', 'couldnt stop', 'over-traded'],
  },
  {
    canonical: 'oversize',
    valence: 'negative',
    category: 'risk',
    synonyms: ['oversize', 'oversized', 'too big', 'max size', 'leveraged up', 'sized up'],
  },
  {
    canonical: 'chase',
    valence: 'negative',
    category: 'execution',
    synonyms: ['chase', 'chased', 'jumped in late', 'ran after'],
  },
  {
    canonical: 'impulsive',
    valence: 'negative',
    category: 'mindset',
    synonyms: ['impulse', 'impulsive', 'snap decision', 'didn\u2019t think', 'didnt think', 'knee-jerk', 'knee jerk'],
  },
  {
    // The *behaviour* — not the feeling. "Euphoria" the emotion lives in
    // the positive list; what hurts a trader is the delusion of being
    // unbeatable after a win streak, which pushes them to oversize the
    // next entry. Keep the synonyms tightly anchored to that meaning.
    canonical: 'overconfident',
    valence: 'negative',
    category: 'mindset',
    synonyms: [
      'overconfident', 'overconfidence',
      'invincible', 'felt invincible',
      'untouchable',
      'unstoppable',
      'bulletproof',
      'can\u2019t lose', 'cant lose',
      'cocky', 'cockiness',
      'on fire',
      'god mode',
    ],
  },
  {
    canonical: 'hesitation',
    valence: 'negative',
    category: 'execution',
    synonyms: ['hesitate', 'froze', 'couldn\u2019t pull', 'couldnt pull the trigger', 'second-guessed', 'second guessed'],
  },
  {
    canonical: 'panic',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['panic', 'panicked', 'panic sold', 'panic exit', 'freaked out'],
  },
  {
    canonical: 'greed',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['greed', 'greedy', 'wanted more', 'didn\u2019t take profit', 'didnt take profit', 'held too long'],
  },
  {
    canonical: 'fear',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['scared', 'afraid', 'anxious', 'nervous'],
  },
  {
    canonical: 'regret',
    valence: 'negative',
    category: 'mindset',
    synonyms: ['regret', 'should have', 'shouldn\u2019t have', 'shouldnt have', 'wish I had'],
  },
  {
    canonical: 'frustration',
    valence: 'negative',
    category: 'emotional',
    synonyms: ['frustrated', 'annoyed', 'fed up', 'pissed off'],
  },
  {
    canonical: 'early-exit',
    valence: 'negative',
    category: 'execution',
    synonyms: ['exited early', 'took profit too early', 'cut winner short', 'cut it short', 'closed too early'],
  },
  {
    canonical: 'averaged-down',
    valence: 'negative',
    category: 'risk',
    synonyms: ['averaged down', 'added to loser', 'doubled down', 'kept adding'],
  },
  {
    canonical: 'no-plan',
    valence: 'negative',
    category: 'process',
    synonyms: ['no plan', 'without a plan', 'didn\u2019t plan', 'didnt plan', 'unplanned'],
  },
  {
    // "The Mask" — professional-sounding language used to dress up poor
    // behaviour after the fact. Context-dependent by nature: "stuck to the
    // plan" is discipline on a winning day and rationalization on a
    // losing one. The lexicon only catches the bluntest tells; the AI
    // enricher is the real detector (see shared.ts prompt, Rule 1).
    canonical: 'rationalization',
    valence: 'negative',
    category: 'mindset',
    synonyms: [
      'rationalized', 'rationalizing', 'rationalization',
      'made excuses', 'making excuses',
      'talked myself into', 'talked myself out of',
    ],
  },
  {
    // "The Gap" — claimed emotional state contradicts the described
    // action ("I was calm" + "took revenge"). Inherently a cross-phrase
    // observation; no single surface form captures it. The AI enricher
    // is the only detector (see shared.ts prompt, Rule 3) — this entry
    // exists so the valence-snap in envelopeToMatches makes it
    // authoritative when the model surfaces it.
    canonical: 'emotional-disconnect',
    valence: 'negative',
    category: 'mindset',
    synonyms: [],
  },
];

// ── Positive — disciplines and good practice ───────────────────────────────
const POSITIVE: readonly LexiconEntry[] = [
  {
    canonical: 'discipline',
    valence: 'positive',
    category: 'process',
    synonyms: ['discipline', 'disciplined', 'stayed disciplined', 'followed rules', 'stuck to rules'],
  },
  {
    canonical: 'patient',
    valence: 'positive',
    category: 'mindset',
    synonyms: ['patient', 'patience', 'waited', 'let it come', 'didn\u2019t force', 'didnt force'],
  },
  {
    canonical: 'plan',
    valence: 'positive',
    category: 'process',
    synonyms: ['stuck to plan', 'followed plan', 'to plan', 'on plan', 'as planned'],
  },
  {
    canonical: 'thesis',
    valence: 'positive',
    category: 'process',
    synonyms: ['thesis played out', 'thesis confirmed', 'as expected', 'as forecast'],
  },
  {
    canonical: 'journaled',
    valence: 'positive',
    category: 'process',
    synonyms: ['journaled', 'wrote it down', 'reviewed', 'logged'],
  },
  {
    canonical: 'sized-down',
    valence: 'positive',
    category: 'risk',
    synonyms: ['sized down', 'smaller size', 'reduced size', 'scaled back', 'half size'],
  },
  {
    canonical: 'cut-loss',
    valence: 'positive',
    category: 'execution',
    synonyms: ['cut the loss', 'took the loss', 'respected stop', 'honored my stop', 'honoured my stop'],
  },
  {
    canonical: 'let-winner',
    valence: 'positive',
    category: 'execution',
    synonyms: ['let it run', 'let winner run', 'rode the trend', 'held the winner'],
  },
  {
    canonical: 'skipped',
    valence: 'positive',
    category: 'execution',
    synonyms: ['skipped', 'didn\u2019t take', 'didnt take', 'passed on', 'stayed flat', 'no trade'],
  },
  {
    canonical: 'waited-setup',
    valence: 'positive',
    category: 'process',
    synonyms: ['waited for setup', 'waited for confirmation', 'waited for entry', 'waited for the trigger'],
  },
  {
    canonical: 'process',
    valence: 'positive',
    category: 'process',
    synonyms: ['followed process', 'stuck to process', 'trusted process', 'trusted the process'],
  },
  {
    canonical: 'accepted',
    valence: 'positive',
    category: 'mindset',
    synonyms: ['accepted the loss', 'moved on', 'let it go'],
  },
  {
    canonical: 'focused',
    valence: 'positive',
    category: 'mindset',
    synonyms: ['focused', 'in the zone', 'dialed in', 'dialled in', 'locked in'],
  },
  {
    canonical: 'calm',
    valence: 'positive',
    category: 'mindset',
    synonyms: ['calm', 'composed', 'relaxed', 'cool-headed'],
  },
  {
    // Euphoria the *feeling* — intense positive affect. The dangerous
    // trader behaviour ("felt invincible", "on fire") lives under
    // `overconfident` in the negative list, not here.
    canonical: 'euphoria',
    valence: 'positive',
    category: 'mindset',
    synonyms: ['euphoria', 'euphoric', 'thrilled', 'ecstatic', 'elated'],
  },
];

// ── Public ─────────────────────────────────────────────────────────────────
/** The full default lexicon. */
export const DEFAULT_LEXICON: readonly LexiconEntry[] = [...NEGATIVE, ...POSITIVE];

/** Convenience: list of canonicals (for stats, UI listings, etc.). */
export function lexiconCanonicals(
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): string[] {
  return lexicon.map((e) => e.canonical);
}

/** Look up an entry by canonical (case-insensitive). */
export function findLexiconEntry(
  canonical: string,
  lexicon: readonly LexiconEntry[] = DEFAULT_LEXICON,
): LexiconEntry | undefined {
  const k = canonical.trim().toLowerCase();
  return lexicon.find((e) => e.canonical.toLowerCase() === k);
}
