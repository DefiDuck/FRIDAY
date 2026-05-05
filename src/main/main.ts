// ── F.R.I.D.A.Y. — Main Process Entry ───────────────────────────────────────
// Responsibilities:
//   - Run as a background tray app (no dock/taskbar icon)
//   - Auto-start with Windows via setLoginItemSettings
//   - Single-instance lock so re-launching brings existing instance forward
//   - Own six renderers: entry / briefing / settings / onboarding /
//                         notes-list / pattern-report
//   - Schedule the wake-time briefing and the session-end journal nudge
//   - Show a "missed" briefing on first launch of the day

import { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage } from 'electron';
import path from 'node:path';
import {
  APP_NAME,
  APP_TOOLTIP,
  APP_USER_MODEL_ID,
  BRIEFING_MIN_HEIGHT,
  BRIEFING_MIN_WIDTH,
  ENTRY_WINDOW_HEIGHT,
  ENTRY_WINDOW_WIDTH,
  JOB_SESSION_END,
  JOB_WAKE,
  SETTINGS_WINDOW_HEIGHT,
  SETTINGS_WINDOW_WIDTH,
  ONBOARDING_WIDTH,
  ONBOARDING_HEIGHT,
} from '../shared/constants';
import type {
  BriefingPayload,
  HighlightMatch,
  NoteEnrichmentMatch,
  NotesListEntry,
  PatternReportPayload,
  SampleBriefingPattern,
  SampleBriefingResult,
  Settings,
} from '../shared/types';
import { DEFAULT_LEXICON } from '../shared/lexicon';
import { Store } from './store';
import { Scheduler } from './scheduler';
import {
  buildHighlightMatches,
  computePatterns,
  findMatchesInText,
} from './pattern-engine';
import { warmupProvider, isProviderAvailable, enrichWithProvider } from './providers';
import type { ProviderConfig, EnrichmentResult } from './providers';
import { createNotesListWindow } from './notes-list-window';
import { createPatternReportWindow } from './pattern-report-window';
import {
  buildNotesListEntry,
  buildPatternReportPayload,
} from './pattern-report-helpers';

// ── Single-instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Windows: proper app identity for toasts ─────────────────────────────────
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// ── Module-scope handles ────────────────────────────────────────────────────
let tray: Tray | null = null;
let entryWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let briefingWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let store: Store | null = null;
const scheduler = new Scheduler();

// v0.1.5 — generic registry for windows that follow the open-or-focus
// pattern (notes-list, pattern-report). The legacy windows above predate
// this helper and keep their dedicated handles for compatibility; new
// windows go through this map.
const openWindows = new Map<string, BrowserWindow>();

function openOrFocusWindow(key: string, factory: () => BrowserWindow): void {
  const existing = openWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = factory();
  openWindows.set(key, win);
  win.on('closed', () => openWindows.delete(key));
}

// ── Windows auto-start ──────────────────────────────────────────────────────
function setLoginItem(openAtLogin: boolean): void {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath,
    // In dev, process.execPath is electron.exe from node_modules — it
    // needs the app directory as its first argument or Windows will boot
    // the bare Electron splash page.  In production (packaged), the exe
    // IS the app and no args are needed.
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
}

// ── Preload path (shared by every window) ───────────────────────────────────
function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

// ── Entry Window ────────────────────────────────────────────────────────────
// Single-instance, but fully destroyed on close so renderer state (e.g. the
// in-flight `saving` flag, the textarea contents) can never leak across
// opens.  Recreation is cheap (~300ms) and guarantees a clean slate.
function openEntryWindow(): void {
  if (entryWindow && !entryWindow.isDestroyed()) {
    entryWindow.show();
    entryWindow.focus();
    return;
  }
  entryWindow = new BrowserWindow({
    width: ENTRY_WINDOW_WIDTH,
    height: ENTRY_WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111315',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  void entryWindow.loadFile(path.join(__dirname, '..', 'renderer', 'entry', 'index.html'));
  entryWindow.once('ready-to-show', () => {
    entryWindow?.show();
    entryWindow?.focus();
  });
  entryWindow.on('closed', () => { entryWindow = null; });
}

// ── Settings Window ─────────────────────────────────────────────────────────
function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    // useContentSize so the dimensions refer to the renderer client area
    // not the OS-chrome'd window — without it the frameless titlebar +
    // borders eat into the 560 px and the form clips again.
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111315',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    settingsWindow?.focus();
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Briefing Window (full-screen modal) ─────────────────────────────────────
// Destroyed on close so the next open refetches the briefing payload and
// picks up any notes written since the last preview.
function openBriefingWindow(): void {
  if (briefingWindow && !briefingWindow.isDestroyed()) {
    briefingWindow.show();
    briefingWindow.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const width = Math.max(BRIEFING_MIN_WIDTH, Math.round(sw * 0.7));
  const height = Math.max(BRIEFING_MIN_HEIGHT, Math.round(sh * 0.7));

  briefingWindow = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0a0c0f',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void briefingWindow.loadFile(path.join(__dirname, '..', 'renderer', 'briefing', 'index.html'));
  briefingWindow.once('ready-to-show', () => {
    briefingWindow?.show();
    briefingWindow?.focus();
  });
  briefingWindow.on('closed', () => { briefingWindow = null; });

  // Mark today's briefing as shown so the catch-up logic doesn't re-fire it
  // on the next launch.  Previews and scheduled fires both count.
  if (store) {
    store.setLastBriefingDate(todayIso());
  }
}

// ── Onboarding Window ──────────────────────────────────────────────────────
// Shown once when settings.onboardingComplete is false. After the user
// picks a provider and clicks Finish, the wizard writes the config and
// closes itself. Subsequent launches skip straight to normal operation.
function openOnboardingWindow(): void {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    width: ONBOARDING_WIDTH,
    height: ONBOARDING_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#0a0c0f',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void onboardingWindow.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding', 'index.html'));
  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow?.show();
    onboardingWindow?.focus();
  });
  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
    // After onboarding closes, kick off warmup if a provider was chosen.
    if (store) {
      const s = store.getSettings();
      if (s.provider.type !== 'none') {
        void warmupProvider(s.provider);
      }
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTodayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Merge AI enrichment matches from the note onto the lexicon-derived
 * highlight list. Lexicon is authoritative — when an AI match overlaps a
 * lexicon match, the lexicon wins (the deterministic engine already
 * carries frequency data the AI doesn't know about). Non-overlapping AI
 * matches are added with source='ai' so the tooltip can show the
 * rationale and the renderer can style them.
 *
 * AI matches don't carry frequency counts, so we surface them at the
 * 'pattern' tier (dotted underline) — they're spot observations about
 * this one note, not trend evidence.
 */
function mergeEnrichment(
  lexiconMatches: HighlightMatch[],
  note: { enrichmentMatches?: Array<{ start: number; end: number; canonical: string; valence: 'negative' | 'positive'; rationale?: string }> } | null,
): HighlightMatch[] {
  if (!note?.enrichmentMatches?.length) return lexiconMatches;

  const taken: Array<{ start: number; end: number }> = lexiconMatches.map((m) => ({
    start: m.start,
    end: m.end,
  }));
  const merged: HighlightMatch[] = [...lexiconMatches];

  for (const em of note.enrichmentMatches) {
    const overlaps = taken.some((t) => em.start < t.end && em.end > t.start);
    if (overlaps) continue;
    taken.push({ start: em.start, end: em.end });
    merged.push({
      keyword: em.canonical,
      surface: em.canonical,
      start: em.start,
      end: em.end,
      classification: 'pattern',
      valence: em.valence,
      count14d: 0,
      count30d: 0,
      source: 'ai',
      rationale: em.rationale,
    });
  }
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

function buildBriefingPayload(): BriefingPayload {
  // Sample notes (from the onboarding "Try It Out" step) are persisted
  // but explicitly excluded from briefing aggregation — see store
  // helpers. Test coverage in src/main/__tests__/store-briefing-filter.
  const lastNote = store?.getLastNoteForBriefing() ?? null;
  const allNotes = store?.getNotesForBriefing() ?? [];

  // Tier 1 — the always-on local lexicon match.
  const lexicon = DEFAULT_LEXICON;
  const { patterns, classifications } = computePatterns(allNotes, lexicon);

  let lexiconMatches: HighlightMatch[] = [];
  if (lastNote && classifications.size > 0) {
    lexiconMatches = buildHighlightMatches(
      lastNote.content,
      lexicon,
      patterns,
      classifications,
    );
  }

  // Tier 2 — AI enrichment (Ollama). Cached on the note itself; we just
  // merge it in here. Empty/absent when enrichment is off or still pending.
  const lastNoteMatches = mergeEnrichment(lexiconMatches, lastNote);

  // Whisper counts: distinct *canonicals* by valence (concern vs strength).
  // We ignore the pattern/habit tier here — the underline weight already
  // conveys frequency; the whisper just tells you what's on the radar.
  let concernCount = 0;
  let strengthCount = 0;
  for (const p of patterns) {
    if (!p.classification) continue;
    if (p.valence === 'positive') strengthCount++;
    else concernCount++;
  }

  return {
    todayLabel: formatTodayLabel(),
    lastNote,
    lastNoteMatches,
    summary: { concernCount, strengthCount },
  };
}

// ── Scheduler wiring ────────────────────────────────────────────────────────
function rescheduleFromSettings(settings: Settings): void {
  scheduler.schedule(JOB_WAKE, settings.wakeTime, () => {
    if (!store) return;
    if (settings.showMorningBriefing) {
      openBriefingWindow();
    }
  });
  scheduler.schedule(JOB_SESSION_END, settings.sessionEndTime, () => {
    // Session-end: pop the entry window with the textarea focused.
    // (Follow-up notification after followUpDelayMinutes is Phase 5+)
    openEntryWindow();
  });
  console.log(`[${APP_NAME}] scheduled:`, scheduler.list());
}

// ── Tray ────────────────────────────────────────────────────────────────────
function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(process.resourcesPath, 'assets', 'icon.png'),
  ];
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: "Write today's note", click: () => openEntryWindow() },
    {
      label: 'View all notes',
      click: () => openOrFocusWindow(
        'notes-list',
        () => createNotesListWindow(preloadPath()),
      ),
    },
    {
      label: 'Pattern report',
      click: () => openOrFocusWindow(
        'pattern-report',
        () => createPatternReportWindow(preloadPath()),
      ),
    },
    { type: 'separator' },
    {
      label: 'Preview morning briefing',
      click: () => openBriefingWindow(),
    },
    {
      label: 'Preview session reminder',
      click: () => openEntryWindow(),
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: `Quit ${APP_NAME}`,
      click: () => app.quit(),
    },
  ]);
}

function createTray(): void {
  const icon = resolveTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(APP_TOOLTIP);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => openEntryWindow());
}

// ── IPC Handlers ────────────────────────────────────────────────────────────
function registerIpcHandlers(s: Store): void {
  ipcMain.handle('note:save', (_evt, rawContent: unknown) => {
    if (typeof rawContent !== 'string') {
      return { ok: false, error: 'Expected string content.' };
    }
    const content = rawContent.trim();
    if (content.length === 0) {
      return { ok: false, error: 'Empty note.' };
    }
    try {
      const note = s.appendNote(content);
      return { ok: true, note };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('note:last', () => s.getLastNote());

  // v0.1.5 — list every non-sample note for the "All notes" window.
  // Builds renderer-shaped entries (resolves lexicon surface forms +
  // AI match phrases) at the IPC boundary; the renderer just lays out.
  ipcMain.handle('notes:list-all', (): NotesListEntry[] => {
    const all = s.getAllNotesForReport(); // newest-first, samples filtered
    return all.map((n) => buildNotesListEntry(n, DEFAULT_LEXICON));
  });

  // v0.1.5 — Pattern Report aggregator. Empty state when <3 notes
  // (work-order §4.2). `computePatterns` is reused as-is (AC #16).
  ipcMain.handle('pattern:report', (): PatternReportPayload => {
    const reportNotes = s.getAllNotesForReport();
    const totalIncludingSamples = s.getNotes().length;
    if (reportNotes.length < 3) {
      return buildPatternReportPayload(reportNotes, null, totalIncludingSamples);
    }
    const computation = computePatterns(reportNotes, DEFAULT_LEXICON);
    return buildPatternReportPayload(
      reportNotes,
      computation,
      totalIncludingSamples,
    );
  });

  ipcMain.handle('settings:get', () => s.getSettings());

  ipcMain.handle('settings:update', (_evt, partial: unknown) => {
    if (!partial || typeof partial !== 'object') {
      return s.getSettings();
    }
    const updated = s.updateSettings(partial as Partial<Settings>);
    // Apply side-effects: reschedule jobs + toggle Windows auto-start.
    rescheduleFromSettings(updated);
    setLoginItem(updated.launchOnStartup);
    return updated;
  });

  ipcMain.handle('briefing:payload', (): BriefingPayload => buildBriefingPayload());

  ipcMain.handle('provider:check', async (_evt, config: unknown): Promise<boolean> => {
    if (!config || typeof config !== 'object') return false;
    try {
      return await isProviderAvailable(config as ProviderConfig);
    } catch {
      return false;
    }
  });

  ipcMain.handle(
    'onboarding:generate-sample-briefing',
    async (_evt, payload: unknown): Promise<SampleBriefingResult> => {
      return generateSampleBriefing(s, payload);
    },
  );

  ipcMain.handle('window:close', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('window:openEntry', () => openEntryWindow());
}

// ── Onboarding sample briefing ─────────────────────────────────────────────
// Saves a single sample note (idempotent — if one already exists from a
// prior re-onboarding, reuses it per AC #9), runs the same lexicon +
// provider pipeline as the real briefing, and returns the combined
// patterns shape the wizard's preview renders. The sample lives in
// store.json with `isSample: true` so the morning briefing's
// aggregation explicitly skips it (see store.getNotesForBriefing).
//
// Hard 12-second budget: the user is staring at a spinner. If the
// provider exceeds it, the in-flight request is left to complete in
// the background (we discard the result) and we surface the friendly
// error fallback per work-order §3.5.
const SAMPLE_BRIEFING_TIMEOUT_MS = 12_000;

async function generateSampleBriefing(
  s: Store,
  payload: unknown,
): Promise<SampleBriefingResult> {
  const content =
    payload && typeof payload === 'object' && typeof (payload as { content?: unknown }).content === 'string'
      ? ((payload as { content: string }).content).trim()
      : '';
  if (content.length < 3) {
    return { ok: false, noteId: '', error: 'Please write a few sentences first.' };
  }

  // AC #9: re-onboarding must not duplicate samples. If one already
  // exists, reuse it — the user typed something new, but we honour
  // "old samples are preserved (don't delete them; just don't add a
  // second)" by treating the existing sample's content as canonical.
  const existing = s.getSampleNote();
  const note = existing ?? s.appendNote(content, { isSample: true });
  const noteContent = note.content;

  // Tier 1: lexicon. Synchronous, can never fail.
  const lexiconRaw = findMatchesInText(noteContent, DEFAULT_LEXICON);

  // Tier 2: provider enrichment with a hard timeout. Provider modules
  // already swallow their own errors and degrade to empty matches, but
  // we wrap with Promise.race so a stuck Ollama can't block the wizard.
  const settings = s.getSettings();
  let aiMatches: NoteEnrichmentMatch[] = [];
  // Stored on the note as the model tag — string-typed so it can hold
  // either a provider key ("ollama") or an actual model id ("phi3.5").
  let aiModel: string = settings.provider.type;
  let providerFailed = false;
  if (settings.provider.type !== 'none') {
    try {
      const result = await Promise.race([
        enrichWithProvider(noteContent, settings.provider),
        new Promise<EnrichmentResult>((resolve) =>
          setTimeout(
            () => resolve({ matches: [], model: settings.provider.type, latencyMs: SAMPLE_BRIEFING_TIMEOUT_MS, error: 'timeout' }),
            SAMPLE_BRIEFING_TIMEOUT_MS,
          ),
        ),
      ]);
      aiMatches = result.matches;
      aiModel = result.model;
      // result.error means dispatcher couldn't resolve the keyRef — that's
      // a soft failure worth surfacing as the friendly fallback.
      if (result.error) providerFailed = true;
    } catch {
      providerFailed = true;
    }
  }

  // Persist enrichment back onto the note so subsequent reads (debug,
  // future "view sample" affordance) see what the wizard saw.
  s.setNoteEnrichment(note.id, aiMatches, aiModel);

  // Combine into the SampleBriefingPattern shape the renderer expects.
  // Lexicon first so its rows render before AI rows in the preview list.
  const patterns: SampleBriefingPattern[] = [];
  for (const m of lexiconRaw) {
    patterns.push({
      canonical: m.canonical,
      valence: m.valence,
      matched: noteContent.slice(m.start, m.end),
      source: 'lexicon',
    });
  }
  for (const m of aiMatches) {
    patterns.push({
      canonical: m.canonical,
      valence: m.valence,
      matched: noteContent.slice(m.start, m.end),
      source: 'ai',
    });
  }

  // §3.5: provider failure → friendly error fallback (note still saved).
  // We bias toward `ok: true` if the lexicon found anything; the error
  // fallback only fires when there's truly nothing useful to show AND
  // the provider failed.
  if (providerFailed && patterns.length === 0) {
    return {
      ok: false,
      noteId: note.id,
      error: 'Couldn’t reach your AI provider right now. Your note is saved — tomorrow morning’s briefing will retry automatically.',
    };
  }
  return { ok: true, noteId: note.id, patterns };
}

// ── Missed-briefing catch-up ────────────────────────────────────────────────
// If the wake-time already passed today and we haven't shown a briefing yet
// today, show it now.  Respects the showMorningBriefing toggle.
function catchUpBriefing(settings: Settings): void {
  if (!settings.showMorningBriefing) return;
  if (!store) return;
  const last = store.getLastBriefingDate();
  if (last === todayIso()) return;
  const match = /^(\d{1,2}):(\d{2})$/.exec(settings.wakeTime);
  if (!match) return;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const now = new Date();
  const wake = new Date();
  wake.setHours(h, m, 0, 0);
  if (now >= wake) {
    // Tiny delay so the tray is visible first.
    setTimeout(() => openBriefingWindow(), 1500);
  }
}

// ── App Lifecycle ───────────────────────────────────────────────────────────
app.on('second-instance', () => {
  openEntryWindow();
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  store = new Store();
  const settings = store.getSettings();
  setLoginItem(settings.launchOnStartup);
  registerIpcHandlers(store);
  createTray();
  rescheduleFromSettings(settings);
  console.log(`[${APP_NAME}] store at:`, store.getFilePath());

  if (!settings.onboardingComplete) {
    // First launch — show the setup wizard instead of the briefing.
    setTimeout(() => openOnboardingWindow(), 500);
  } else {
    // Normal launch — check for missed briefing and warm the provider.
    catchUpBriefing(settings);
    if (settings.provider.type !== 'none') {
      void warmupProvider(settings.provider);
    }
  }
});

app.on('window-all-closed', () => {
  // Intentional no-op: tray keeps the process alive even with no windows.
});
