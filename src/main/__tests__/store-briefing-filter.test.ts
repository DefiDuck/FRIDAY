// ── Tests for the briefing-aggregation filter ────────────────────────────
// AC #6: sample notes (isSample: true) must be excluded from the morning
// briefing. The Store class can't be instantiated under node --test
// because its constructor calls Electron's `app.getPath`, so we test the
// extracted helper directly. Store.getNotesForBriefing() delegates here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterBriefingNotes } from '../briefing-filter';
import type { Note } from '../../shared/types';

function fakeNote(partial: Partial<Note>): Note {
  return {
    id: partial.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? Date.now(),
    content: partial.content ?? 'note text',
    keywords: partial.keywords ?? [],
    sessionDate: partial.sessionDate,
    enrichmentMatches: partial.enrichmentMatches,
    enrichedModel: partial.enrichedModel,
    enrichedAt: partial.enrichedAt,
    isSample: partial.isSample,
  };
}

test('filterBriefingNotes: excludes notes flagged isSample=true (AC #6)', () => {
  const real1 = fakeNote({ id: 'real-1', content: 'Took the ES setup, stuck to my plan.' });
  const sample = fakeNote({ id: 'sample-1', content: 'onboarding sample', isSample: true });
  const real2 = fakeNote({ id: 'real-2', content: 'Got back at the market on YM.' });

  const filtered = filterBriefingNotes([real1, sample, real2]);
  const ids = filtered.map((n) => n.id);

  assert.equal(filtered.length, 2, 'sample note must be removed');
  assert.deepEqual(ids, ['real-1', 'real-2'], 'real notes order preserved');
  assert.equal(
    filtered.some((n) => n.isSample === true),
    false,
    'no isSample-true note may survive the filter',
  );
});

test('filterBriefingNotes: keeps notes where isSample is undefined or false', () => {
  const a = fakeNote({ id: 'a' }); // isSample undefined
  const b = fakeNote({ id: 'b', isSample: false }); // explicit false
  const c = fakeNote({ id: 'c', isSample: true }); // sample

  const filtered = filterBriefingNotes([a, b, c]);
  assert.deepEqual(filtered.map((n) => n.id), ['a', 'b']);
});

test('filterBriefingNotes: empty input → empty output', () => {
  assert.deepEqual(filterBriefingNotes([]), []);
});

test('filterBriefingNotes: all-samples input → empty output (degenerate case)', () => {
  const samples = [
    fakeNote({ id: 's1', isSample: true }),
    fakeNote({ id: 's2', isSample: true }),
  ];
  assert.deepEqual(filterBriefingNotes(samples), []);
});

test('filterBriefingNotes: returned array is a fresh copy (no aliasing)', () => {
  const input: Note[] = [fakeNote({ id: 'x' })];
  const out = filterBriefingNotes(input);
  out.push(fakeNote({ id: 'mutation' }));
  assert.equal(input.length, 1, 'mutating output must not mutate input');
});
