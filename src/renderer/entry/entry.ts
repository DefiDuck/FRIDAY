// ── Entry Window Renderer ───────────────────────────────────────────────────
// Keybindings:
//   Ctrl+Enter → save note (trimmed, non-empty), flash "Saved", auto-close
//   Esc        → discard and close
// Communicates with the main process exclusively via window.friday.

export {};

const textarea = document.getElementById('note-input') as HTMLTextAreaElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
const dateLabel = document.getElementById('date-label') as HTMLSpanElement;

// ── Date label ──────────────────────────────────────────────────────────────
function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}
dateLabel.textContent = formatDate(new Date());

// ── Status flash ────────────────────────────────────────────────────────────
let statusTimer: number | null = null;
function flashStatus(msg: string, kind: 'ok' | 'err'): void {
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusEl.classList.remove('ok', 'err', 'fade');
  statusEl.classList.add(kind);
  statusEl.textContent = msg;
  statusTimer = window.setTimeout(() => {
    statusEl.classList.add('fade');
  }, 1200);
}

// ── Save flow ───────────────────────────────────────────────────────────────
let saving = false;

async function saveAndClose(): Promise<void> {
  if (saving) return;
  const content = textarea.value.trim();
  if (content.length === 0) {
    flashStatus('Empty — nothing to save.', 'err');
    return;
  }
  saving = true;
  try {
    const res = await window.friday.saveNote(content);
    if (res.ok) {
      flashStatus('Saved', 'ok');
      // Give the user a beat to see "Saved" then hide.
      window.setTimeout(() => {
        textarea.value = '';
        void window.friday.closeWindow();
      }, 400);
    } else {
      flashStatus(`Error: ${res.error}`, 'err');
      saving = false;
    }
  } catch (err) {
    flashStatus(`Error: ${(err as Error).message}`, 'err');
    saving = false;
  }
}

function discardAndClose(): void {
  textarea.value = '';
  void window.friday.closeWindow();
}

// ── Keybindings ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void saveAndClose();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    discardAndClose();
  }
});

closeBtn.addEventListener('click', () => discardAndClose());

// Focus the textarea reliably even after show/hide cycles.
window.addEventListener('focus', () => textarea.focus());
textarea.focus();

// v0.1.4: window entry animation per DECISIONS_LOCKED §11.2
// (modal-enter — fade + 8px translate over 220ms via animations.css).
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('modal-enter');
});
