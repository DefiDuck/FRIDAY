// ── Pattern Report Renderer (v0.1.5) ────────────────────────────────────────
// Renders the aggregated `computePatterns` output as concern/strength
// groups, sorted by 30-day count desc within each group. Each canonical
// is wired with `attachPopover` (from v0.1.4 shared module) so the user
// can hover/click for the lexicon synonyms + category — value-additive
// over the inline label.

export {};

import { attachPopover, type PopoverHandle } from '../shared/popover.js';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const closeBtn = $<HTMLButtonElement>('close-btn');
const refreshBtn = $<HTMLButtonElement>('refresh-btn');
const headerEl = $<HTMLDivElement>('header');
const summaryEl = $<HTMLDivElement>('summary');
const listEl = $<HTMLDivElement>('list');
const emptyEl = $<HTMLDivElement>('empty-state');
const footerEl = $<HTMLDivElement>('footer');
const generatedEl = $<HTMLSpanElement>('generated');

// Module-level handle list — destroyed on every re-render. Refresh
// implicitly tears these down via re-render.
const popoverHandles: PopoverHandle[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatGenerated(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} · ${hh}:${min}`;
}

function formatLastSeen(ts: number | null): string {
  if (ts === null) return 'never';
  const now = Date.now();
  const ageMs = now - ts;
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs < dayMs) return 'today';
  if (ageMs < 2 * dayMs) return 'yesterday';
  const days = Math.floor(ageMs / dayMs);
  return `${days} days ago`;
}

// ── Popover content builder ───────────────────────────────────────────────
// Pattern Report popover surfaces the lexicon category — the canonical
// is already shown inline so frequency would be redundant. Category is
// the hidden value (work order header note: "popover on canonical adds
// the lexicon synonyms / category, which IS hidden, so the popover is
// value-additive there too").
function buildCanonicalPopover(trigger: HTMLElement): HTMLElement {
  const canonical = trigger.dataset.canonical ?? '';
  const valence = trigger.dataset.valence ?? 'negative';
  const category = trigger.dataset.category ?? 'mindset';
  const classification = trigger.dataset.classification ?? 'occasional';

  const valenceLabel = valence === 'positive' ? 'strength' : 'concern';

  const el = document.createElement('div');
  el.className = 'popover';

  const safeCanonical = escapeHtml(canonical);
  const safeCategory = escapeHtml(category);

  el.innerHTML = `
    <h4 class="pop-title">${safeCanonical} · <span class="pop-valence">${valenceLabel}</span></h4>
    <p class="pop-body">Category: <strong>${safeCategory}</strong></p>
    <div class="pop-meta">Classification: ${classification}</div>
    <div class="pop-arrow"></div>
  `;
  return el;
}

// ── Card builder ──────────────────────────────────────────────────────────
function buildPatternCard(p: RendererPatternReportEntry): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'pattern-card';

  // ── Head: dot · canonical · classification pill ──────────────────────
  const head = document.createElement('div');
  head.className = 'head';

  const dot = document.createElement('div');
  dot.className = `dot ${p.valence === 'positive' ? 'pos' : 'neg'}`;
  head.appendChild(dot);

  const marker = document.createElement('span');
  marker.className = `pattern-marker ${p.valence === 'positive' ? 'positive' : 'negative'}`;
  marker.textContent = p.canonical;
  marker.dataset.canonical = p.canonical;
  marker.dataset.valence = p.valence;
  marker.dataset.category = p.category;
  marker.dataset.classification = p.classification;
  head.appendChild(marker);

  const pill = document.createElement('span');
  pill.className = `classification-pill ${p.classification}`;
  pill.textContent = p.classification.charAt(0).toUpperCase() + p.classification.slice(1);
  head.appendChild(pill);

  card.appendChild(head);

  // ── Meta block: counts + streaks ─────────────────────────────────────
  const meta = document.createElement('div');
  meta.className = 'meta';

  const valenceWord = p.valence === 'positive' ? 'strength' : 'concern';
  // Pick the more informative window for the prominent count.
  const isHabit = p.classification === 'habit';
  const primaryCount = isHabit ? p.count30d : p.count14d;
  const primaryWindow = isHabit ? '30 days' : '14 days';
  const noun = primaryCount === 1 ? 'mention' : 'mentions';

  const lineA = document.createElement('div');
  lineA.innerHTML =
    `${valenceWord} · ${primaryCount} ${noun} in last ${primaryWindow}`;
  meta.appendChild(lineA);

  const lineB = document.createElement('div');
  const streakNoun = p.longestStreak === 1 ? 'session' : 'sessions';
  lineB.innerHTML =
    `<span class="label">longest streak:</span> ${p.longestStreak} ${streakNoun} · ` +
    `<span class="label">last seen:</span> ${escapeHtml(formatLastSeen(p.lastSeenAt))}`;
  meta.appendChild(lineB);

  card.appendChild(meta);

  // ── Sample matches (italic, up to 3) ─────────────────────────────────
  if (p.sampleMatches.length > 0) {
    const matches = document.createElement('div');
    matches.className = 'matches';
    for (const m of p.sampleMatches) {
      const line = document.createElement('div');
      line.className = 'matched-line';
      line.textContent = m;
      matches.appendChild(line);
    }
    card.appendChild(matches);
  }

  return card;
}

// ── Sort + group helpers ──────────────────────────────────────────────────
function sortPatterns(
  patterns: RendererPatternReportEntry[],
): { concerns: RendererPatternReportEntry[]; strengths: RendererPatternReportEntry[] } {
  const concerns: RendererPatternReportEntry[] = [];
  const strengths: RendererPatternReportEntry[] = [];
  for (const p of patterns) {
    (p.valence === 'positive' ? strengths : concerns).push(p);
  }
  // Within each group, count30d desc; tiebreak by canonical for
  // deterministic ordering across refreshes.
  const sortFn = (a: RendererPatternReportEntry, b: RendererPatternReportEntry) =>
    b.count30d - a.count30d || a.canonical.localeCompare(b.canonical);
  concerns.sort(sortFn);
  strengths.sort(sortFn);
  return { concerns, strengths };
}

// ── Render flow ────────────────────────────────────────────────────────────
function renderEmpty(_payload: RendererPatternReportPayload): void {
  headerEl.hidden = true;
  listEl.hidden = true;
  footerEl.hidden = true;
  emptyEl.hidden = false;
}

function renderReport(payload: RendererPatternReportPayload): void {
  // Tear down prior popovers (refresh path).
  for (const h of popoverHandles) h.destroy();
  popoverHandles.length = 0;

  emptyEl.hidden = true;
  headerEl.hidden = false;
  listEl.hidden = false;
  footerEl.hidden = false;
  listEl.innerHTML = '';

  // Header summary.
  const distinct = payload.patterns.length;
  const noteNoun = payload.totalNotesExcludingSample === 1 ? 'note' : 'notes';
  const patternNoun = distinct === 1 ? 'distinct pattern' : 'distinct patterns';
  summaryEl.textContent =
    `${payload.totalNotesExcludingSample} ${noteNoun} · ${distinct} ${patternNoun}`;

  generatedEl.textContent = `Generated: ${formatGenerated(payload.generatedAt)}`;

  const { concerns, strengths } = sortPatterns(payload.patterns);

  if (concerns.length > 0) {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = 'Concerns';
    listEl.appendChild(label);
    for (const p of concerns) listEl.appendChild(buildPatternCard(p));
  }
  if (strengths.length > 0) {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = 'Strengths';
    listEl.appendChild(label);
    for (const p of strengths) listEl.appendChild(buildPatternCard(p));
  }

  // Wire popovers AFTER the markup hits the DOM.
  const markers = listEl.querySelectorAll<HTMLElement>('.pattern-marker');
  for (const el of markers) {
    popoverHandles.push(attachPopover(el, buildCanonicalPopover));
  }
}

async function load(): Promise<void> {
  const payload = await window.friday.getPatternReport();
  if (payload.isEmpty) {
    renderEmpty(payload);
  } else {
    renderReport(payload);
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => void window.friday.closeWindow());

refreshBtn.addEventListener('click', () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';
  void load().finally(() => {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  });
});

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void window.friday.closeWindow();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('modal-enter');
});

void load();
