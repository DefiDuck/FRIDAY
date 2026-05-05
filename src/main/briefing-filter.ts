// ── Briefing-aggregation filter ─────────────────────────────────────────────
// Single source of truth for "which notes feed the morning briefing".
// Sample notes (written via the onboarding "Try It Out" step) are excluded —
// see DECISIONS_LOCKED §5.1 and the work-order AC #6. Tested in isolation
// by src/main/__tests__/store-briefing-filter.test.ts so we don't have to
// boot Electron just to verify the filter.

import type { Note } from '../shared/types';

/** Strip out onboarding sample notes. Order is preserved; everything else
 *  (dedupe, sorting, recency cap) is the briefing pipeline's job. */
export function filterBriefingNotes(notes: readonly Note[]): Note[] {
  return notes.filter((n) => n.isSample !== true);
}
