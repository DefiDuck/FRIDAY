// ── Preload Bridge ──────────────────────────────────────────────────────────
// Shared by every renderer (entry, briefing, settings, onboarding,
// notes-list, pattern-report).

import { contextBridge, ipcRenderer } from 'electron';
import type { FridayAPI } from '../shared/api';

const api: FridayAPI = {
  saveNote: (content) => ipcRenderer.invoke('note:save', content),
  getLastNote: () => ipcRenderer.invoke('note:last'),
  listAllNotes: () => ipcRenderer.invoke('notes:list-all'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  getBriefingPayload: () => ipcRenderer.invoke('briefing:payload'),
  getPatternReport: () => ipcRenderer.invoke('pattern:report'),
  checkProvider: (config) => ipcRenderer.invoke('provider:check', config),
  generateSampleBriefing: (content) =>
    ipcRenderer.invoke('onboarding:generate-sample-briefing', { content }),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openEntry: () => ipcRenderer.invoke('window:openEntry'),
};

contextBridge.exposeInMainWorld('friday', api);
