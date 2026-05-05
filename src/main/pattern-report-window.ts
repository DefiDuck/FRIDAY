// ── Pattern Report BrowserWindow factory ────────────────────────────────────
// v0.1.5 — wires the "Pattern report" tray menu item.
// Pure window construction; the renderer at src/renderer/pattern-report/
// pulls data via `friday.getPatternReport()` (IPC channel `pattern:report`).

import { BrowserWindow } from 'electron';
import path from 'node:path';
import {
  PATTERN_REPORT_WIDTH,
  PATTERN_REPORT_HEIGHT,
  PATTERN_REPORT_MIN_HEIGHT,
  PATTERN_REPORT_MAX_HEIGHT,
} from '../shared/constants';

/**
 * Construct the Pattern Report window. Like the Notes List window
 * (sibling factory), this window is non-modal and width-locked but
 * vertically resizable, and a second tray click focuses the existing
 * instance via `openOrFocusWindow` in main.ts.
 */
export function createPatternReportWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: PATTERN_REPORT_WIDTH,
    height: PATTERN_REPORT_HEIGHT,
    minWidth: PATTERN_REPORT_WIDTH,
    maxWidth: PATTERN_REPORT_WIDTH,
    minHeight: PATTERN_REPORT_MIN_HEIGHT,
    maxHeight: PATTERN_REPORT_MAX_HEIGHT,
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

  void win.loadFile(
    path.join(__dirname, '..', 'renderer', 'pattern-report', 'index.html'),
  );
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  return win;
}
