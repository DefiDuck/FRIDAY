// ── JSON File Store ─────────────────────────────────────────────────────────
// All persistence lives in a single store.json inside app.getPath('userData').
// Load once on startup, write-through on every mutation.
// Small enough to stay in memory; avoids electron-store's CJS/ESM churn.

import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Note, NoteEnrichmentMatch, StoreSchema, Settings, StoredProviderConfig } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { DEFAULT_LEXICON } from '../shared/lexicon';
import { extractKeywords } from './pattern-engine';
import { isProviderAvailable, enrichWithProvider, setSecrets } from './providers';
import { createSecrets, type SecretsImpl } from './secrets/secrets';
import { migrateLegacyApiKey } from './secrets/migrate';
import { filterBriefingNotes } from './briefing-filter';

const STORE_FILENAME = 'store.json';

function defaultState(): StoreSchema {
  return {
    notes: [],
    patterns: [],
    settings: { ...DEFAULT_SETTINGS },
    lastBriefingDate: null,
  };
}

export class Store {
  private path: string;
  private state: StoreSchema;
  private secrets: SecretsImpl;

  constructor() {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = path.join(dir, STORE_FILENAME);
    // Boot the Secrets module before load() so the v0.1.0 → v0.1.1
    // plaintext-apiKey migration can encrypt and replace in one shot.
    this.secrets = createSecrets(dir, safeStorage);
    // Register with the dispatcher so enrichWithProvider can resolve
    // keyRefs at call time. Single-process Electron — safe registry.
    setSecrets(this.secrets);
    this.state = this.load();
  }

  /** Absolute path to the backing JSON file. */
  getFilePath(): string {
    return this.path;
  }

  private load(): StoreSchema {
    if (!existsSync(this.path)) return defaultState();
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreSchema>;
      const mergedSettings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };

      // ── Migration: reminderTime → sessionEndTime ────────────────────
      if (
        parsed.settings &&
        typeof (parsed.settings as { reminderTime?: unknown }).reminderTime === 'string' &&
        !Object.prototype.hasOwnProperty.call(parsed.settings, 'sessionEndTime')
      ) {
        mergedSettings.sessionEndTime = (parsed.settings as { reminderTime: string }).reminderTime;
      }
      delete mergedSettings.reminderTime;

      // ── Migration: enrichmentEnabled + enrichmentModel → provider ───
      // Pre-provider-refactor builds stored `enrichmentEnabled` + a
      // flat `enrichmentModel`. Collapse into the new discriminated
      // union. claudeApiKey was never actually used for enrichment so
      // we drop it rather than migrate it forward.
      const legacyEnabled = (parsed.settings as { enrichmentEnabled?: unknown } | undefined)
        ?.enrichmentEnabled;
      const legacyModel = (parsed.settings as { enrichmentModel?: unknown } | undefined)
        ?.enrichmentModel;
      const hasProvider = !!(parsed.settings && (parsed.settings as { provider?: unknown }).provider);
      if (!hasProvider) {
        if (legacyEnabled === true && typeof legacyModel === 'string' && legacyModel.length > 0) {
          mergedSettings.provider = { type: 'ollama', model: legacyModel };
        } else {
          mergedSettings.provider = { type: 'none' };
        }
        // A store written before the wizard is considered "already used"
        // — don't blast the user with onboarding on their existing data.
        if (!Object.prototype.hasOwnProperty.call(parsed.settings ?? {}, 'onboardingComplete')) {
          mergedSettings.onboardingComplete = true;
        }
      }
      delete mergedSettings.enrichmentEnabled;
      delete mergedSettings.enrichmentModel;
      delete mergedSettings.claudeApiKey;

      // ── Migration: plaintext provider.apiKey → secrets.bin keyRef ───
      // v0.1.0 stored cloud provider keys in plaintext on settings.
      // v0.1.1 encrypts them via DPAPI/safeStorage; store.json holds
      // only an opaque keyRef. This is the one-shot upgrade path. The
      // helper is idempotent — second-launch sees no apiKey and no-ops.
      const mig = migrateLegacyApiKey(mergedSettings, this.secrets);
      if (mig.warnings.length > 0) {
        for (const w of mig.warnings) console.warn('[store:migrate]', w);
      }
      const finalSettings = mig.migrated ? mig.settings : mergedSettings;

      const merged: StoreSchema = {
        notes: parsed.notes ?? [],
        patterns: parsed.patterns ?? [],
        settings: finalSettings,
        lastBriefingDate: parsed.lastBriefingDate ?? null,
      };

      // If migration rewrote settings, persist immediately so the
      // plaintext key never survives past the first launch of v0.1.1.
      // We write directly here rather than calling persist() because
      // persist() reads from this.state, which isn't assigned yet.
      if (mig.migrated) {
        this.persistState(merged);
      }

      return merged;
    } catch (err) {
      console.error('[store] failed to parse store.json, resetting:', err);
      return defaultState();
    }
  }

  /** Atomic write: serialize → tmp file → rename. */
  private persist(): void {
    this.persistState(this.state);
  }

  /** Same as persist(), but writes an arbitrary state — used by load()
   *  to flush a freshly-migrated state before this.state is assigned. */
  private persistState(state: StoreSchema): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  // ── Notes ─────────────────────────────────────────────────────────────
  /**
   * Persist a new note and (by default) kick off background AI enrichment.
   *
   * `options.isSample`: marks the note as the onboarding "Try It Out"
   *   sample. Sample notes are excluded from the real briefing
   *   aggregation (see getNotesForBriefing); they also skip the
   *   fire-and-forget enrichment path because the onboarding IPC handler
   *   runs the same pipeline synchronously and writes the result back
   *   via setNoteEnrichment. (Without that skip we'd race the handler.)
   */
  appendNote(content: string, options?: { isSample?: boolean }): Note {
    const trimmed = content.trim();
    // Canonicals are extracted via the lexicon (synonyms collapse to root).
    // settings.seedKeywords is reserved for future user-added canonicals;
    // wire it in once the settings UI exposes the editor.
    const note: Note = {
      id: randomUUID(),
      timestamp: Date.now(),
      content: trimmed,
      keywords: extractKeywords(trimmed, DEFAULT_LEXICON),
      sessionDate: this.todayIso(),
      ...(options?.isSample ? { isSample: true } : {}),
    };
    this.state.notes.push(note);
    this.persist();

    // Fire-and-forget AI enrichment. Returns immediately so the user's
    // "Saved" confirmation isn't blocked by a 3-10s round trip.
    // When enrichment completes, we update the note in-place and persist
    // again so the next briefing render picks it up. Skipped for sample
    // notes — the onboarding IPC handler runs enrichment synchronously
    // and stores the result via setNoteEnrichment().
    const provider = this.state.settings.provider;
    if (!options?.isSample && provider.type !== 'none') {
      void this.enrichInBackground(note.id, trimmed, provider);
    }

    return note;
  }

  /**
   * Public counterpart of the private updateEnrichment helper. Used by
   * the onboarding sample-briefing IPC handler in main.ts to write the
   * synchronously-computed AI matches onto the just-saved sample note.
   * Idempotent and safe to call after enrichment failures (just stores
   * an empty match list with the model tag for diagnostics).
   */
  setNoteEnrichment(noteId: string, matches: NoteEnrichmentMatch[], model: string): void {
    this.updateEnrichment(noteId, matches, model);
  }

  /**
   * Find an existing onboarding sample note, if any. Used by the IPC
   * handler to enforce AC #9 — "re-onboarding does not duplicate
   * samples". Returns the most recent sample if multiple somehow exist
   * (shouldn't, but be defensive).
   */
  getSampleNote(): Note | null {
    const samples = this.state.notes.filter((n) => n.isSample === true);
    if (samples.length === 0) return null;
    samples.sort((a, b) => b.timestamp - a.timestamp);
    return samples[0]!;
  }

  /**
   * Update an existing note's enrichment fields and persist. No-op if the
   * note was deleted between save and enrichment completion.
   */
  private updateEnrichment(
    noteId: string,
    matches: Note['enrichmentMatches'],
    model: string,
  ): void {
    const idx = this.state.notes.findIndex((n) => n.id === noteId);
    if (idx === -1) return;
    const existing = this.state.notes[idx]!;
    this.state.notes[idx] = {
      ...existing,
      enrichmentMatches: matches,
      enrichedModel: model,
      enrichedAt: Date.now(),
    };
    this.persist();
  }

  private async enrichInBackground(
    noteId: string,
    content: string,
    provider: StoredProviderConfig,
  ): Promise<void> {
    try {
      const available = await isProviderAvailable(provider);
      if (!available) {
        console.warn(`[store] enrichment skipped — provider ${provider.type} unavailable`);
        return;
      }
      const result = await enrichWithProvider(content, provider);
      if (result.error) {
        // Dispatcher couldn't resolve the keyRef (e.g. keychain
        // unavailable). Free tier still works; surface for the operator.
        console.warn(`[store] enrichment unavailable: ${result.error}`);
      }
      this.updateEnrichment(noteId, result.matches, result.model);
      console.log(
        `[store] enriched note ${noteId.slice(0, 8)} via ${provider.type} (${result.matches.length} match(es) in ${result.latencyMs}ms)`,
      );
    } catch (err) {
      // Providers never throw, but belt & braces.
      console.warn('[store] enrichment error:', (err as Error).message);
    }
  }

  getNotes(): Note[] {
    return [...this.state.notes].sort((a, b) => b.timestamp - a.timestamp);
  }

  getLastNote(): Note | null {
    const sorted = this.getNotes();
    return sorted[0] ?? null;
  }

  /**
   * Notes used by the morning briefing aggregator. Strips out anything
   * marked `isSample` so the user's onboarding "Try It Out" note doesn't
   * pollute their first real briefing — the briefing for day 1 would
   * otherwise be a copy of the sample they just saw, which is uncanny
   * and breaks the illusion (work order §6, AC #6). The filter lives
   * in briefing-filter.ts so the test can exercise it without booting
   * Electron.
   */
  getNotesForBriefing(): Note[] {
    return filterBriefingNotes(this.getNotes());
  }

  /** Most recent non-sample note, for the briefing's "last reflection" card. */
  getLastNoteForBriefing(): Note | null {
    const sorted = this.getNotesForBriefing();
    return sorted[0] ?? null;
  }

  /**
   * v0.1.5 — notes used by the Pattern Report aggregator and the
   * "View all notes" window. Same isSample filter as the briefing,
   * delegated to the same helper so the two surfaces can never drift
   * (a sample showing up in only one of them would be confusing).
   *
   * Newest-first ordering matches `getNotes()`. The "View all notes"
   * window relies on this order; the Pattern Report aggregator
   * (`computePatterns`) sorts internally and is order-agnostic.
   */
  getAllNotesForReport(): Note[] {
    return filterBriefingNotes(this.getNotes());
  }

  // ── Settings ──────────────────────────────────────────────────────────
  getSettings(): Settings {
    return { ...this.state.settings };
  }

  updateSettings(partial: Partial<Settings>): Settings {
    // Merge first so migration sees the post-merge provider shape.
    const merged: Settings = { ...this.state.settings, ...partial };
    // The onboarding wizard (and future Settings UI in P4b) submits a
    // provider object with a plaintext apiKey field over IPC. Run the
    // same migration we run at boot so the plaintext never lands in
    // store.json — a keyRef goes in instead, and the encrypted blob
    // lands in secrets.bin. Idempotent for already-migrated providers.
    const mig = migrateLegacyApiKey(merged, this.secrets);
    if (mig.warnings.length > 0) {
      for (const w of mig.warnings) console.warn('[store:migrate]', w);
    }
    this.state.settings = mig.migrated ? mig.settings : merged;
    this.persist();
    return this.getSettings();
  }

  // ── Briefing bookkeeping ──────────────────────────────────────────────
  getLastBriefingDate(): string | null {
    return this.state.lastBriefingDate;
  }

  setLastBriefingDate(dateIso: string): void {
    this.state.lastBriefingDate = dateIso;
    this.persist();
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  private todayIso(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
