// ── Notes List Renderer (v0.1.5) ────────────────────────────────────────────
// Renders the user's full note history as a chronological card list.
// Click a card to expand inline — full text + per-note pattern matches.
// Pattern markers inside expanded cards are wired with `attachPopover`
// from the v0.1.4 shared module; we never reimplement popovers.
//
// Read-only in v0.1.5 — no edit / delete / search / filter (work order §9.2).

export {};

import { attachPopover, type PopoverHandle } from '../shared/popover.js';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const closeBtn = $<HTMLButtonElement>('close-btn');
const headerEl = $<HTMLDivElement>('header');
const summaryEl = $<HTMLDivElement>('summary');
const listEl = $<HTMLDivElement>('list');
const emptyEl = $<HTMLDivElement>('empty-state');

// One handle per popover trigger across all expanded cards. Cleared on
// every full re-render; per-card subset is destroyed on collapse.
const popoverHandles: PopoverHandle[] = [];

// ── Date formatting ────────────────────────────────────────────────────────
// Today / Yesterday / This week (weekday) / older (YYYY-MM-DD).
function formatNoteDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today · ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;

  // Within the last 6 days but not today/yesterday → weekday name.
  const ageMs = now.getTime() - d.getTime();
  const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;
  if (ageMs >= 0 && ageMs <= SIX_DAYS) {
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
    return `${weekday} · ${time}`;
  }

  // Older — ISO date for unambiguous reference.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} · ${time}`;
}

function isoDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── HTML escape helper ────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Popover content builder ───────────────────────────────────────────────
// Same shape as the briefing's pattern popover (DECISIONS_LOCKED §10.4).
// Reads data-* attributes off the trigger so we don't capture render
// closures — the builder runs at show-time, every time.
function buildPatternPopover(trigger: HTMLElement): HTMLElement {
  const canonical = trigger.dataset.canonical ?? '';
  const valence = trigger.dataset.valence ?? 'negative';
  const source = trigger.dataset.source ?? 'lexicon';
  const matched = trigger.dataset.matched ?? '';

  const valenceLabel = valence === 'positive' ? 'strength' : 'concern';
  const sourceLabel = source === 'ai' ? 'AI' : 'lexicon';

  const el = document.createElement('div');
  el.className = 'popover';

  const safeCanonical = escapeHtml(canonical);
  const safeMatched = escapeHtml(matched);

  // Notes-list popover surfaces the matched phrase (so the user can
  // see exactly what triggered the marker even after collapsing the
  // body) — the briefing's popover surfaces frequency instead. Pure
  // additive value over the inline label.
  const matchedRow = safeMatched
    ? `<p class="pop-body">Matched: <span class="text-mono">"${safeMatched}"</span></p>`
    : '';

  el.innerHTML = `
    <h4 class="pop-title">${safeCanonical} · <span class="pop-valence">${valenceLabel}</span></h4>
    ${matchedRow}
    <div class="pop-meta">Detected by: ${sourceLabel}</div>
    <div class="pop-arrow"></div>
  `;
  return el;
}

// ── Card builders ──────────────────────────────────────────────────────────
function buildPatternRow(p: RendererNotesListEntry['patterns'][number]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pattern-row';

  const dot = document.createElement('div');
  dot.className = `dot ${p.valence === 'positive' ? 'pos' : 'neg'}`;
  row.appendChild(dot);

  // The canonical span uses the .pattern-marker class so the shared
  // animations.css cursor:pointer rule kicks in. data-* attributes feed
  // the popover builder.
  const marker = document.createElement('span');
  marker.className = `pattern-marker ${p.valence === 'positive' ? 'positive' : 'negative'}`;
  marker.textContent = p.canonical;
  marker.dataset.canonical = p.canonical;
  marker.dataset.valence = p.valence;
  marker.dataset.source = p.source;
  marker.dataset.matched = p.matched;
  row.appendChild(marker);

  const matchedTxt = document.createElement('span');
  matchedTxt.className = 'matched';
  matchedTxt.textContent = `(matched “${p.matched}”)`;
  row.appendChild(matchedTxt);

  const tag = document.createElement('span');
  tag.className = 'src-tag';
  tag.textContent = p.source === 'ai' ? 'AI' : 'Lex';
  row.appendChild(tag);

  return row;
}

function buildNoteCard(entry: RendererNotesListEntry): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.dataset.id = entry.id;

  // ── Head (always visible) ──────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'note-head';

  const metaCol = document.createElement('div');
  metaCol.className = 'meta-col';
  const dateLine = document.createElement('div');
  dateLine.className = 'date';
  dateLine.textContent = formatNoteDate(entry.createdAt);
  metaCol.appendChild(dateLine);

  const previewLine = document.createElement('div');
  previewLine.className = 'preview';
  previewLine.textContent = entry.preview;
  metaCol.appendChild(previewLine);
  head.appendChild(metaCol);

  // Pattern-count pill (helpful at-a-glance signal). Tinted teal when
  // the note actually has detected patterns.
  const pill = document.createElement('span');
  pill.className = entry.patternCount > 0 ? 'pattern-pill has-patterns' : 'pattern-pill';
  pill.textContent = entry.patternCount === 1 ? '1 pattern' : `${entry.patternCount} patterns`;
  head.appendChild(pill);

  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.textContent = '▾';
  head.appendChild(chev);

  card.appendChild(head);

  // ── Body (visible only when expanded) ──────────────────────────────
  const body = document.createElement('div');
  body.className = 'note-body';

  const fullText = document.createElement('div');
  fullText.className = 'full-text';
  fullText.textContent = entry.fullText;
  body.appendChild(fullText);

  if (entry.patterns.length > 0) {
    const section = document.createElement('div');
    section.className = 'patterns-section';
    const label = document.createElement('div');
    label.className = 'patterns-label';
    label.textContent = 'Patterns detected';
    section.appendChild(label);
    for (const p of entry.patterns) {
      section.appendChild(buildPatternRow(p));
    }
    body.appendChild(section);
  }
  card.appendChild(body);

  // ── Expand toggle ──────────────────────────────────────────────────
  // Per-card popover handles, attached on first expand and torn down on
  // collapse so listeners don't leak across hundreds of notes.
  const cardHandles: PopoverHandle[] = [];

  head.addEventListener('click', () => {
    const willExpand = !card.classList.contains('expanded');
    card.classList.toggle('expanded');

    if (willExpand) {
      const markers = body.querySelectorAll<HTMLElement>('.pattern-marker');
      for (const el of markers) {
        const h = attachPopover(el, buildPatternPopover);
        cardHandles.push(h);
        popoverHandles.push(h);
      }
    } else {
      for (const h of cardHandles) h.destroy();
      cardHandles.length = 0;
    }
  });

  return card;
}

// ── Render flow ────────────────────────────────────────────────────────────
function renderEmpty(): void {
  headerEl.hidden = true;
  listEl.hidden = true;
  emptyEl.hidden = false;
}

function renderList(entries: RendererNotesListEntry[]): void {
  // Tear down any prior popovers — render is idempotent if ever called twice.
  for (const h of popoverHandles) h.destroy();
  popoverHandles.length = 0;
  listEl.innerHTML = '';

  emptyEl.hidden = true;
  headerEl.hidden = false;
  listEl.hidden = false;

  // Header summary: "N notes · oldest YYYY-MM-DD" (or just "N notes" when
  // the user has only today's notes).
  const oldest = entries[entries.length - 1];
  const total = entries.length;
  const noun = total === 1 ? 'note' : 'notes';
  if (oldest) {
    summaryEl.textContent = `${total} ${noun} · oldest ${isoDate(oldest.createdAt)}`;
  } else {
    summaryEl.textContent = `${total} ${noun}`;
  }

  for (const entry of entries) {
    listEl.appendChild(buildNoteCard(entry));
  }
}

async function load(): Promise<void> {
  const entries = await window.friday.listAllNotes();
  if (entries.length === 0) {
    renderEmpty();
    return;
  }
  renderList(entries);
}

// ── Wiring ─────────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => void window.friday.closeWindow());

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void window.friday.closeWindow();
  }
});

// Window entry animation per DECISIONS_LOCKED §11.2.
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('modal-enter');
});

void load();
