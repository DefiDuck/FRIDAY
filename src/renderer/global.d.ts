// Renderer-side ambient types.
// All interfaces live inside `declare global` so every renderer (entry,
// briefing, settings, onboarding, notes-list, pattern-report) sees them
// without an import.
//
// Keep in sync with src/shared/{api,types}.ts — this file mirrors their
// shape without crossing the renderer's rootDir.

export {};

declare global {
  interface RendererNote {
    id: string;
    timestamp: number;
    content: string;
    keywords: string[];
    sessionDate?: string;
    isSample?: boolean;
  }

  interface RendererSettings {
    wakeTime: string;
    sessionEndTime: string;
    reminderTime?: string;
    claudeApiKey?: string | null;
    seedKeywords: string[];
    enrichmentEnabled: boolean;
    enrichmentModel: string;
    launchOnStartup: boolean;
    showMorningBriefing: boolean;
    followUpDelayMinutes: number;
    provider?: { type: string; model?: string; apiKey?: string; baseUrl?: string; keyRef?: string };
    onboardingComplete?: boolean;
    skippedSampleBriefing?: boolean;
  }

  interface RendererSampleBriefingPattern {
    canonical: string;
    valence: RendererValence;
    matched: string;
    source: 'lexicon' | 'ai';
  }

  type RendererSampleBriefingResult =
    | { ok: true; noteId: string; patterns: RendererSampleBriefingPattern[] }
    | { ok: false; noteId: string; error: string };

  type RendererValence = 'negative' | 'positive';

  interface RendererHighlightMatch {
    keyword: string;
    surface: string;
    start: number;
    end: number;
    classification: 'pattern' | 'habit';
    valence: RendererValence;
    count14d: number;
    count30d: number;
    source: 'lexicon' | 'ai';
    rationale?: string;
  }

  interface RendererBriefingSummary {
    concernCount: number;
    strengthCount: number;
  }

  interface RendererBriefingPayload {
    todayLabel: string;
    lastNote: RendererNote | null;
    lastNoteMatches: RendererHighlightMatch[];
    summary: RendererBriefingSummary;
  }

  // ── v0.1.5: Notes List + Pattern Report ─────────────────────────────────
  interface RendererNotesListEntry {
    id: string;
    createdAt: number;
    preview: string;
    fullText: string;
    isSample: boolean;
    patternCount: number;
    patterns: Array<{
      canonical: string;
      valence: RendererValence;
      matched: string;
      source: 'lexicon' | 'ai';
    }>;
  }

  interface RendererPatternReportEntry {
    canonical: string;
    valence: RendererValence;
    category: string;
    classification: 'pattern' | 'habit' | 'occasional';
    count14d: number;
    count30d: number;
    currentStreak: number;
    longestStreak: number;
    lastSeenAt: number | null;
    sampleMatches: string[];
  }

  interface RendererPatternReportPayload {
    generatedAt: number;
    totalNotes: number;
    totalNotesExcludingSample: number;
    windowDays: 30;
    patterns: RendererPatternReportEntry[];
    isEmpty: boolean;
  }

  interface FridayAPI {
    saveNote(content: string): Promise<
      | { ok: true; note: RendererNote }
      | { ok: false; error: string }
    >;
    getLastNote(): Promise<RendererNote | null>;
    listAllNotes(): Promise<RendererNotesListEntry[]>;
    getSettings(): Promise<RendererSettings>;
    updateSettings(partial: Partial<RendererSettings>): Promise<RendererSettings>;
    getBriefingPayload(): Promise<RendererBriefingPayload>;
    getPatternReport(): Promise<RendererPatternReportPayload>;
    checkProvider(config: Record<string, unknown>): Promise<boolean>;
    generateSampleBriefing(content: string): Promise<RendererSampleBriefingResult>;
    closeWindow(): Promise<void>;
    openEntry(): Promise<void>;
  }

  interface Window {
    friday: FridayAPI;
  }
}
