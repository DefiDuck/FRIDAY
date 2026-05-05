// ── Tests for the v0.1.5 Notes List + Pattern Report IPC builders ─────────
// We can't boot the Store under `node --test` (Electron `app` isn't
// available), so the tests exercise the extracted helpers directly —
// same pattern as store-briefing-filter.test.ts.
//
// Coverage:
//   - buildPatternReportPayload empty-state (AC #7)
//   - buildPatternReportPayload populated mapping
//   - pickUpTo3Matches dedupe + cap

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPatternReportPayload,
  buildNotesListEntry,
  pickUpTo3Matches,
} from '../pattern-report-helpers';
import { computePatterns } from '../pattern-engine';
import { DEFAULT_LEXICON } from '../../shared/lexicon';
import type { Note } from '../../shared/types';

function fakeNote(partial: Partial<Note> & { content: string }): Note {
  return {
    id: partial.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? Date.now(),
    content: partial.content,
    keywords: partial.keywords ?? [],
    sessionDate: partial.sessionDate,
    enrichmentMatches: partial.enrichmentMatches,
    enrichedModel: partial.enrichedModel,
    enrichedAt: partial.enrichedAt,
    isSample: partial.isSample,
  };
}

test('pattern-report empty-state: <3 notes returns isEmpty:true', () => {
  const NOW = 1_700_000_000_000;
  const notes = [
    fakeNote({ content: 'Took a clean ES break setup, stuck to the plan.', timestamp: NOW - 1000 }),
    fakeNote({ content: 'Got back at the market on YM after the loss.',    timestamp: NOW - 2000 }),
  ];
  const payload = buildPatternReportPayload(notes, null, /*totalNotes*/ 2, NOW);

  assert.equal(payload.isEmpty, true, 'isEmpty must flip when <3 notes');
  assert.deepEqual(payload.patterns, [], 'patterns must be empty in empty-state');
  assert.equal(payload.totalNotes, 2);
  assert.equal(payload.totalNotesExcludingSample, 2);
  assert.equal(payload.windowDays, 30);
  assert.equal(payload.generatedAt, NOW);
});

test('pattern-report populated: mapping covers null→occasional + sample matches', () => {
  // Three notes, all mentioning "revenge" — that hits the PATTERN
  // tier (3+ in 14d) so the engine returns classification='pattern'.
  // We also include a "discipline" mention with only 1 occurrence,
  // which should map to classification='occasional' (engine returns null).
  const NOW = 1_700_000_000_000;
  const notes = [
    fakeNote({ content: 'Got back at the market on ES.',          timestamp: NOW - 1000 }),
    fakeNote({ content: 'Took revenge on YM after the loss.',      timestamp: NOW - 2000 }),
    fakeNote({ content: 'Anger trade on CL — payback for ES.',     timestamp: NOW - 3000 }),
    fakeNote({ content: 'Stayed disciplined the rest of the day.', timestamp: NOW - 4000 }),
  ];
  const computation = computePatterns(notes, DEFAULT_LEXICON, { now: NOW });
  const payload = buildPatternReportPayload(notes, computation, 4, NOW);

  assert.equal(payload.isEmpty, false);
  assert.equal(payload.totalNotes, 4);
  assert.equal(payload.totalNotesExcludingSample, 4);
  assert.ok(payload.patterns.length >= 2, `expected >=2 patterns, got ${payload.patterns.length}`);

  const revenge = payload.patterns.find((p) => p.canonical === 'revenge');
  assert.ok(revenge, 'revenge canonical must be present');
  assert.equal(revenge.valence, 'negative');
  assert.equal(revenge.classification, 'pattern',
    `revenge with 3 mentions should be classification='pattern' not '${revenge.classification}'`);
  assert.equal(revenge.count14d, 3);
  assert.equal(revenge.category, 'emotional', 'lexicon category passthrough');
  assert.ok(revenge.sampleMatches.length >= 1, 'sampleMatches must include at least one phrase');
  assert.ok(revenge.lastSeenAt !== null, 'lastSeenAt must be a real timestamp');

  const discipline = payload.patterns.find((p) => p.canonical === 'discipline');
  if (discipline) {
    // Single mention falls below the pattern threshold — engine returns
    // null classification, helper maps to 'occasional'.
    assert.equal(discipline.classification, 'occasional',
      `discipline with 1 mention should map null→'occasional' not '${discipline.classification}'`);
  }
});

test('pickUpTo3Matches: dedupes and caps at 3', () => {
  const NOW = 1_700_000_000_000;
  const notes = [
    // First two notes have the same surface "got back at" — must dedupe.
    fakeNote({ content: 'Got back at the market on ES.',          timestamp: NOW - 1000 }),
    fakeNote({ content: 'Got back at the market again on YM.',     timestamp: NOW - 2000 }),
    // Distinct surfaces — count up.
    fakeNote({ content: 'Pure anger trade on CL.',                 timestamp: NOW - 3000 }),
    fakeNote({ content: 'Took revenge on the gold drop.',          timestamp: NOW - 4000 }),
    // Fifth distinct hit — should be ignored (cap at 3).
    fakeNote({ content: 'Vengeance on NQ for the morning loss.',   timestamp: NOW - 5000 }),
  ];

  const matches = pickUpTo3Matches(notes, 'revenge');

  assert.equal(matches.length, 3, 'must cap at 3');
  // Dedup: two "got back at" surfaces collapse to one entry.
  const lower = matches.map((m) => m.toLowerCase());
  const gotBackAtCount = lower.filter((m) => m.includes('got back at')).length;
  assert.equal(gotBackAtCount, 1, 'duplicate surface form must be deduped');
});

test('buildNotesListEntry: lexicon + AI markers both surface', () => {
  const content = 'Got back at the market on ES — felt invincible after the win.';
  const aiPhrase = 'felt invincible';
  const aiStart = content.indexOf(aiPhrase);
  const note = fakeNote({
    id: 'note-mix',
    content,
    timestamp: 1_700_000_000_000,
    enrichmentMatches: [
      { start: aiStart, end: aiStart + aiPhrase.length,
        canonical: 'overconfident', valence: 'negative',
        rationale: 'illusion of being unbeatable' },
    ],
  });

  const entry = buildNotesListEntry(note, DEFAULT_LEXICON);

  assert.equal(entry.id, 'note-mix');
  assert.equal(entry.preview, note.content.slice(0, 120));
  assert.equal(entry.fullText, note.content);
  assert.equal(entry.isSample, false);
  // At least one lexicon marker (revenge) and one AI marker (overconfident).
  const sources = entry.patterns.map((p) => p.source);
  assert.ok(sources.includes('lexicon'), 'lexicon marker missing');
  assert.ok(sources.includes('ai'), 'AI marker missing');
  const ai = entry.patterns.find((p) => p.source === 'ai');
  assert.ok(ai, 'AI marker not found');
  assert.equal(ai.canonical, 'overconfident');
  assert.equal(ai.matched, 'felt invincible');
});

test('buildNotesListEntry: isSample=true is preserved on the entry', () => {
  const note = fakeNote({ content: 'sample onboarding note', isSample: true });
  const entry = buildNotesListEntry(note);
  assert.equal(entry.isSample, true);
});
