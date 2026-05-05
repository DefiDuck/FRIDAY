// ── Notes List BrowserWindow factory ────────────────────────────────────────
// v0.1.5 — wires the "View all notes" tray menu item.
// Pure window construction; the renderer at src/renderer/notes-list/ pulls
// data via `friday.listAllNotes()` (IPC channel `notes:list-all`).

import { BrowserWindow } from 'electron';
import path from 'node:path';
import {
  NOTES_LIST_WIDTH,
  NOTES_LIST_HEIGHT,
  NOTES_LIST_MIN_HEIGHT,
  NOTES_LIST_MAX_HEIGHT,
} from '../shared/constants';

/**
 * Construct the Notes List window. Caller is responsible for tracking
 * the instance (see `openOrFocusWindow` in main.ts) so a second tray
 * click focuses the existing window instead of opening a duplicate.
 *
 * The window is intentionally NOT modal (work-order §7) — testers should
 * be able to write a note while reviewing the list.
 */
export function createNotesListWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: NOTES_LIST_WIDTH,
    height: NOTES_LIST_HEIGHT,
    minWidth: NOTES_LIST_WIDTH,
    maxWidth: NOTES_LIST_WIDTH,
    minHeight: NOTES_LIST_MIN_HEIGHT,
    maxHeight: NOTES_LIST_MAX_HEIGHT,
    // Width fixed; vertical resize allowed (work-order §5.1).
    resizable: true,
    useContentSize: true,
    show: false,
    frame: false,
    skipTaskbar: true,
    backgroundColor: '#0E1014',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // BrowserWindow honours min/max height but its width clamping with the
  // same min===max trick is the cleanest way to lock width while leaving
  // height-resize gestures intact on Windows.

  void win.loadFile(
    path.join(__dirname, '..', 'renderer', 'notes-list', 'index.html'),
  );
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  return win;
}
