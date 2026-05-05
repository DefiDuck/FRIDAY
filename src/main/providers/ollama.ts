// ── Ollama Provider ─────────────────────────────────────────────────────────
// Talks to a local Ollama daemon on localhost:11434 (configurable).
// Cost: zero. Privacy: nothing leaves the machine. Latency: 1-10s warm,
// 15-30s cold-start on first load of the day.
//
// Recommended models:
//   phi3.5           — 3.8B, ~2.4 GB, Microsoft's instruction-tuned pick (default)
//   qwen2.5:3b       — best structured-output at small size
//   llama3.2:3b      — slightly better nuance, slightly larger

import type { OllamaConfig, EnrichmentResult } from './types';
import { OLLAMA_DEFAULT_URL, ENRICHMENT_TIMEOUT_MS, WARMUP_TIMEOUT_MS } from '../../shared/constants';
import { buildPrompt, parseEnvelope, envelopeToMatches } from './shared';

// ── HTTP response shapes ───────────────────────────────────────────────────
interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}
interface OllamaGenerateResponse {
  response?: string;
  done?: boolean;
}

function resolveBase(config: OllamaConfig): string {
  return (config.baseUrl ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
}

// ── Public: availability probe ─────────────────────────────────────────────
/** True if the daemon is reachable AND the configured model is pulled. */
export async function isAvailable(config: OllamaConfig): Promise<boolean> {
  const baseUrl = resolveBase(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return false;
    const json = (await res.json()) as OllamaTagsResponse;
    const wanted = config.model.toLowerCase();
    const names = (json.models ?? []).map((m) => (m.name ?? '').toLowerCase());
    const wantedHasTag = wanted.includes(':');
    return names.some((n) => {
      if (wantedHasTag) return n === wanted;
      return n.split(':')[0] === wanted;
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public: warm-up ────────────────────────────────────────────────────────
/**
 * Trivial 1-token generation to load the model into Ollama's memory so the
 * first real request doesn't pay cold-start cost (20-30s on CPU for 3-4B
 * models). Silent on failure — best-effort.
 */
export async function warmup(config: OllamaConfig): Promise<void> {
  const baseUrl = resolveBase(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: 'hi',
        stream: false,
        options: { num_predict: 1 },
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      console.log(`[provider:ollama] ${config.model} warmed in ${Date.now() - started}ms`);
    }
  } catch {
    // silent — will pay cold-start on first real request
  } finally {
    clearTimeout(timer);
  }
}

// ── Public: per-note enrichment ────────────────────────────────────────────
export async function enrich(
  content: string,
  config: OllamaConfig,
): Promise<EnrichmentResult> {
  const baseUrl = resolveBase(config);
  const started = Date.now();
  const empty: EnrichmentResult = { matches: [], model: config.model, latencyMs: 0 };

  const trimmed = content.trim();
  if (trimmed.length < 3) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: buildPrompt(trimmed),
        stream: false,
        format: 'json',
        options: {
          temperature: 0.2,
          // 600 headroom: the pragmatics-rich prompt can surface 4-6 matches
          // per note with 5-10 word rationales, which lands around 350-450
          // output tokens. Truncation here manifests as cut-off JSON that
          // fails parseEnvelope, so we pay a small latency tax for safety.
          num_predict: 600,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[provider:ollama] http', res.status);
      return { ...empty, latencyMs: Date.now() - started };
    }
    const body = (await res.json()) as OllamaGenerateResponse;
    const envelope = parseEnvelope(body.response ?? '');
    const matches = envelope ? envelopeToMatches(envelope, trimmed) : [];
    return { matches, model: config.model, latencyMs: Date.now() - started };
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.warn('[provider:ollama] failed:', (err as Error).message);
    }
    return { ...empty, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
