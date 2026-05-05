// ── None Provider ──────────────────────────────────────────────────────────
// Explicit no-op. The user chose "lexicon only" in onboarding, or never
// configured an AI. Everything returns empty / true so the calling code
// never needs to special-case "no provider configured" branches.

import type { EnrichmentResult } from './types';

export async function isAvailable(): Promise<boolean> {
  return true; // always "available" — the no-op always succeeds
}

export async function warmup(): Promise<void> {
  // nothing to warm
}

export async function enrich(): Promise<EnrichmentResult> {
  return { matches: [], model: 'none', latencyMs: 0 };
}
