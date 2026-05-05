// ── Settings Window Renderer ────────────────────────────────────────────────
// Reads current settings on load, writes back on Save, flashes confirmation.

export {};

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const wake = $<HTMLInputElement>('wake');
const end = $<HTMLInputElement>('end');
const followup = $<HTMLInputElement>('followup');
const startup = $<HTMLInputElement>('startup');
const briefing = $<HTMLInputElement>('briefing');
const saveBtn = $<HTMLButtonElement>('save-btn');
const closeBtn = $<HTMLButtonElement>('close-btn');
const statusEl = $<HTMLSpanElement>('status');
const diag = $<HTMLDivElement>('diag');

let statusTimer: number | null = null;
function flash(msg: string, kind: 'ok' | 'err'): void {
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusEl.classList.remove('ok', 'err', 'fade');
  statusEl.classList.add(kind);
  statusEl.textContent = msg;
  statusTimer = window.setTimeout(() => statusEl.classList.add('fade'), 1600);
}

function humanDelta(totalMinutes: number): string {
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function nextFireLabel(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return '—';
  const h = Number(match[1]);
  const m = Number(match[2]);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const deltaMin = Math.round((next.getTime() - now.getTime()) / 60000);
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  const when = next.toDateString() === now.toDateString() ? 'today' : 'tomorrow';
  return `${hh}:${mm} ${when} (in ${humanDelta(deltaMin)})`;
}

function updateDiag(): void {
  diag.textContent =
    `Next wake: ${nextFireLabel(wake.value)} · ` +
    `Next session-end: ${nextFireLabel(end.value)}`;
}

async function load(): Promise<void> {
  const s = await window.friday.getSettings();
  wake.value = s.wakeTime || '07:00';
  end.value = s.sessionEndTime || '16:30';
  followup.value = String(s.followUpDelayMinutes ?? 45);
  startup.checked = !!s.launchOnStartup;
  briefing.checked = !!s.showMorningBriefing;
  updateDiag();
}

async function save(): Promise<void> {
  saveBtn.disabled = true;
  try {
    await window.friday.updateSettings({
      wakeTime: wake.value,
      sessionEndTime: end.value,
      followUpDelayMinutes: Math.max(0, Math.min(240, Number(followup.value) || 45)),
      launchOnStartup: startup.checked,
      showMorningBriefing: briefing.checked,
    });
    flash('Saved', 'ok');
    updateDiag();
  } catch (err) {
    flash(`Error: ${(err as Error).message}`, 'err');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', () => void save());
closeBtn.addEventListener('click', () => void window.friday.closeWindow());

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void window.friday.closeWindow();
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void save();
  }
});

[wake, end].forEach((el) => el.addEventListener('input', updateDiag));

// v0.1.4: window entry animation per DECISIONS_LOCKED §11.2
// (modal-enter — fade + 8px translate over 220ms via animations.css).
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('modal-enter');
});

void load();
