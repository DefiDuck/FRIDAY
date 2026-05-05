// Smoke test for the pattern engine + lexicon.
// Runs against the compiled CJS output so we hit the same code the app does.
import {
  computePatterns,
  findMatchesInText,
  buildHighlightMatches,
  extractKeywords,
} from '../dist/main/pattern-engine.js';
import { DEFAULT_LEXICON } from '../dist/shared/lexicon.js';

const now = Date.now();
const day = 86_400_000;

// A trader's last two weeks. Mix of negative (revenge/fomo/tilt) and
// positive (patient/discipline/cut-loss) — and several SYNONYMS that the
// flat keyword list would have missed entirely.
const notes = [
  { id: '1', timestamp: now - 13 * day, content: 'First note: took an anger trade after losing.', keywords: [] },
  { id: '2', timestamp: now - 10 * day, content: 'FOMO\u2019d into NQ at the open — fear of missing the move.', keywords: [] },
  { id: '3', timestamp: now - 7  * day, content: 'Got back at the market after the morning loss. Sized up.', keywords: [] },
  { id: '4', timestamp: now - 5  * day, content: 'Stayed disciplined — waited for setup, didn\u2019t force it.', keywords: [] },
  { id: '5', timestamp: now - 3  * day, content: 'Revenge traded again after ES stopped me out. Tilted hard.', keywords: [] },
  { id: '6', timestamp: now - 2  * day, content: 'Cut the loss when the thesis broke. Stuck to plan.', keywords: [] },
  { id: '7', timestamp: now - 1  * day, content: 'Closed ES too early \u2014 classic early exit, but stayed patient on the second trade.', keywords: [] },
];

const { patterns, classifications } = computePatterns(notes, DEFAULT_LEXICON, { now });

console.log('\u2500\u2500 classifications \u2500\u2500');
for (const [canonical, cls] of classifications.entries()) {
  const entry = patterns.find((p) => p.keyword === canonical);
  const v = entry?.valence ?? '?';
  console.log(`  ${canonical.padEnd(14)} \u2192 ${cls.padEnd(8)} (${v})`);
}

console.log('\n\u2500\u2500 patterns ranked \u2500\u2500');
for (const p of [...patterns].sort((a, b) => b.occurrences.length - a.occurrences.length)) {
  console.log(
    `  ${p.keyword.padEnd(14)} occ=${p.occurrences.length}  streak=${p.currentStreak}  ` +
    `class=${p.classification ?? '\u2014'}  valence=${p.valence}`,
  );
}

console.log('\n\u2500\u2500 synonym attribution check \u2500\u2500');
const synCheck = [
  'Got back at the market hard',
  'fear of missing out on the rally',
  'Stayed disciplined and waited for setup',
  'cut the loss and moved on',
  'doubled down into a loser',
];
for (const text of synCheck) {
  const canonicals = extractKeywords(text, DEFAULT_LEXICON);
  console.log(`  "${text}"`);
  console.log(`    \u2192 ${canonicals.join(', ') || '(no match)'}`);
}

console.log('\n\u2500\u2500 highlights on a note mentioning a classified canonical \u2500\u2500');
// Pick the newest note that contains at least one classified canonical so the
// output is non-empty (newest-overall might mention only one-offs).
const classifiedSet = new Set(classifications.keys());
const target =
  [...notes]
    .sort((a, b) => b.timestamp - a.timestamp)
    .find((n) => extractKeywords(n.content, DEFAULT_LEXICON).some((k) => classifiedSet.has(k))) ??
  notes[notes.length - 1];

console.log(`  note: "${target.content}"`);
const highlights = buildHighlightMatches(target.content, DEFAULT_LEXICON, patterns, classifications, now);
if (highlights.length === 0) {
  console.log('  (no classified canonicals in any note)');
}
for (const m of highlights) {
  console.log(
    `    [${m.start}-${m.end}] "${target.content.slice(m.start, m.end)}" ` +
    `\u2192 ${m.keyword} (${m.valence}, ${m.classification}, 14d=${m.count14d}, 30d=${m.count30d})`,
  );
}

console.log('\n\u2500\u2500 raw match (overlap resolution) \u2500\u2500');
for (const m of findMatchesInText('ES stopped me out on the stop loss; I just panicked.', DEFAULT_LEXICON)) {
  const text = 'ES stopped me out on the stop loss; I just panicked.';
  console.log(`  [${m.start}-${m.end}] "${text.slice(m.start, m.end)}" \u2192 ${m.canonical} (${m.valence})`);
}
