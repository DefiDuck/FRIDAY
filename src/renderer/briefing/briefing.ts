// ── Morning Briefing Renderer ───────────────────────────────────────────────
// Pulls the payload from main, populates the card, wraps recurring keywords
// in <span class="mark-* tier-* src-*"> spans, and (v0.1.4) attaches a
// custom popover to each marker — replacing the v0.1.2 native `title`
// tooltips banned by DECISIONS_LOCKED §10.

export {};

import { attachPopover, type PopoverHandle } from '../shared/popover.js';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const dateLabel = $<HTMLDivElement>('date-label');
const card = $<HTMLDivElement>('card');
const cardLabel = $<HTMLDivElement>('card-label');
const cardMeta = $<HTMLDivElement>('card-meta');
const cardBody = $<HTMLDivElement>('card-body');
const whisper = $<HTMLDivElement>('whisper');
const writeBtn = $<HTMLButtonElement>('write-btn');
const dismissBtn = $<HTMLButtonElement>('dismiss-btn');

// ── Formatting helpers ──────────────────────────────────────────────────────
function formatNoteDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  if (wasYesterday) return `Yesterday · ${time}`;
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  }) + ` · ${time}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build HTML for `text` with `matches` wrapped in valence/tier/source spans.
 * Matches are assumed non-overlapping and sorted by start (the main process
 * guarantees this).  Text outside matches is escaped; whitespace + newlines
 * are preserved because the container uses white-space: pre-wrap.
 *
 * Each marker carries data-* attributes that buildPatternPopover reads at
 * show-time. The native `title` attribute (used in v0.1.2 / v0.1.3) is
 * banned by work-order AC #2.
 *
 * Class scheme: three orthogonal axes combined into one className.
 *   * valence  -> mark-concern  (negative) | mark-strength (positive)
 *   * tier     -> tier-pattern  (3+ in 14d) | tier-habit (5+ in 30d)
 *   * source   -> src-lexicon   (deterministic) | src-ai (semantic)
 */
function renderHighlighted(
  text: string,
  matches: RendererHighlightMatch[],
): string {
  if (matches.length === 0) return escapeHtml(text);
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor || m.end > text.length) continue;
    html += escapeHtml(text.slice(cursor, m.start));

    const valenceCls = m.valence === 'positive' ? 'mark-strength' : 'mark-concern';
    const tierCls = m.classification === 'habit' ? 'tier-habit' : 'tier-pattern';
    const sourceCls = m.source === 'ai' ? 'src-ai' : 'src-lexicon';

    // AI matches surface the model's rationale as the popover summary.
    // Lexicon matches don't carry a per-match rationale — the canonical
    // is its own description.
    const summary = m.source === 'ai' && m.rationale ? m.rationale : '';
    const freq = m.classification === 'habit' ? m.count30d : m.count14d;
    const windowLabel = m.classification === 'habit' ? '30 days' : '14 days';

    html += '<span'
      + ` class="${valenceCls} ${tierCls} ${sourceCls}"`
      + ` data-canonical="${escapeHtml(m.keyword)}"`
      + ` data-valence="${m.valence}"`
      + ` data-classification="${m.classification}"`
      + ` data-source="${m.source}"`
      + ` data-summary="${escapeHtml(summary)}"`
      + ` data-frequency="${freq}"`
      + ` data-window="${windowLabel}"`
      + '>';
    html += escapeHtml(text.slice(m.start, m.end));
    html += '</span>';
    cursor = m.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

// ── Popover wiring (v0.1.4) ─────────────────────────────────────────────────
// One handle per marker. Re-rendering the card destroys the prior set
// and reattaches fresh handles so listeners can't leak across updates.
const popoverHandles: PopoverHandle[] = [];

function buildPatternPopover(trigger: HTMLElement): HTMLElement {
  const canonical = trigger.dataset.canonical ?? '';
  const valence = trigger.dataset.valence ?? 'negative';
  const classification = trigger.dataset.classification ?? 'pattern';
  const source = trigger.dataset.source ?? 'lexicon';
  const summary = trigger.dataset.summary ?? '';
  const frequency = parseInt(trigger.dataset.frequency ?? '0', 10);
  const windowLabel = trigger.dataset.window ?? '14 days';

  const valenceLabel = valence === 'positive' ? 'strength' : 'concern';
  const sourceLabel = source === 'ai' ? 'AI' : 'lexicon';

  const el = document.createElement('div');
  el.className = 'popover';

  // Defensive escapes: canonical comes from the lexicon (safe) but
  // summary comes from AI rationale (untrusted text).
  const safeCanonical = escapeHtml(canonical);
  const safeSummary = escapeHtml(summary);
  const summaryRow = safeSummary
    ? `<p class="pop-body">${safeSummary}</p>`
    : '';

  // Lexicon matches surface a frequency line; AI matches are one-off
  // observations with no recurrence to count.
  const tier = classification === 'habit' ? 'Habit' : 'Pattern';
  const freqRow = source === 'lexicon' && frequency > 0
    ? `<div class="pop-meta">${tier} · ${frequency}× in last ${windowLabel} · Detected by: ${sourceLabel}</div>`
    : `<div class="pop-meta">Detected by: ${sourceLabel}</div>`;

  el.innerHTML = `
    <h4 class="pop-title">${safeCanonical} · <span class="pop-valence">${valenceLabel}</span></h4>
    ${summaryRow}
    ${freqRow}
    <div class="pop-arrow"></div>
  `;
  return el;
}

function wirePopovers(): void {
  // Tear down any prior wiring before re-attaching — load() runs once
  // per window mount today, but future code may re-render the card.
  for (const h of popoverHandles) h.destroy();
  popoverHandles.length = 0;

  const markers = cardBody.querySelectorAll<HTMLElement>('span[class*="mark-"]');
  for (const el of markers) {
    popoverHandles.push(attachPopover(el, buildPatternPopover));
  }
}

function renderWhisper(summary: RendererBriefingSummary): void {
  const total = summary.concernCount + summary.strengthCount;
  if (total === 0) {
    whisper.classList.add('hidden');
    whisper.textContent = '';
    return;
  }
  const parts: string[] = [];
  if (summary.concernCount > 0) {
    parts.push(
      `${summary.concernCount} concern${summary.concernCount === 1 ? '' : 's'}`,
    );
  }
  if (summary.strengthCount > 0) {
    parts.push(
      `${summary.strengthCount} strength${summary.strengthCount === 1 ? '' : 's'}`,
    );
  }
  whisper.textContent = parts.join(' · ') + ' watching';
  whisper.classList.remove('hidden');
}

// ── Load flow ───────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  const payload = await window.friday.getBriefingPayload();
  dateLabel.textContent = payload.todayLabel;

  if (payload.lastNote) {
    cardLabel.textContent = 'Last reflection';
    cardMeta.textContent = formatNoteDate(payload.lastNote.timestamp);
    cardBody.innerHTML = renderHighlighted(
      payload.lastNote.content,
      payload.lastNoteMatches,
    );
    card.classList.remove('empty');
    // v0.1.4: attach popovers AFTER the markup hits the DOM so we can
    // querySelector the freshly-emitted spans.
    wirePopovers();
  } else {
    cardLabel.textContent = 'No notes yet';
    cardMeta.textContent = '';
    cardBody.textContent = "You haven't written anything yet. Start today.";
    card.classList.add('empty');
  }

  renderWhisper(payload.summary);
}

// ── Actions ─────────────────────────────────────────────────────────────────
async function writeNow(): Promise<void> {
  await window.friday.openEntry();
  await window.friday.closeWindow();
}

dismissBtn.addEventListener('click', () => void window.friday.closeWindow());
writeBtn.addEventListener('click', () => void writeNow());

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault();
    void window.friday.closeWindow();
  }
});

// v0.1.4: animate the window's first paint per DECISIONS_LOCKED §11.2
// (modal entry: fade + 8px translate over 220ms). Onboarding skips
// this — its own screen transitions already supply motion.
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('modal-enter');
});

void load();
