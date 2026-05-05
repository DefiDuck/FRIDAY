// ── Anthropic (Claude) Provider ────────────────────────────────────────────
// Hits the Claude Messages API. User-owned API key — F.R.I.D.A.Y. never
// proxies or stores anything server-side; the key lives in the local
// settings JSON and travels only to api.anthropic.com.
//
// Recommended models:
//   claude-haiku-4-5   — fastest + cheapest, great for this task (default)
//   claude-sonnet-4-5  — slightly better nuance, ~5x the cost per note
//
// Cost frame of reference: at ~200 input + 100 output tokens per note and
// Haiku pricing, a single note runs ~$0.0001. One note/day = cents/year.

import type { AnthropicConfig, EnrichmentResult } from './types';
import { ENRICHMENT_TIMEOUT_MS } from '../../shared/constants';
import { buildPrompt, parseEnvelope, envelopeToMatches, sanitizeError } from './shared';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

// ── Public: availability probe ─────────────────────────────────────────────
/**
 * Cheap check: API key is present and non-empty. We don't actually hit the
 * API for a "ping" — that would cost a token every startup. If the key is
 * wrong, `enrich` will fail silently and return empty matches.
 */
export async function isAvailable(config: AnthropicConfig): Promise<boolean> {
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 10;
}

// ── Public: warm-up ────────────────────────────────────────────────────────
/** No warm-up needed — cloud API has no cold-start from our side. */
export async function warmup(_config: AnthropicConfig): Promise<void> {
  // no-op
}

// ── Public: per-note enrichment ────────────────────────────────────────────
export async function enrich(
  content: string,
  config: AnthropicConfig,
): Promise<EnrichmentResult> {
  const started = Date.now();
  const empty: EnrichmentResult = { matches: [], model: config.model, latencyMs: 0 };

  const trimmed = content.trim();
  if (trimmed.length < 3) return empty;
  if (!config.apiKey || config.apiKey.length < 10) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 512,
        temperature: 0.2,
        // System prompt carries the instructions; user message is the note.
        // This keeps the instructions out of the per-request content hash
        // and lets Anthropic cache the system prompt server-side.
        system:
          'You extract behavioural patterns from a trader\u2019s journal. ' +
          'Always return valid JSON only, no prose.',
        messages: [
          {
            role: 'user',
            content: buildPrompt(trimmed),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn('[provider:anthropic] http', res.status);
      return { ...empty, latencyMs: Date.now() - started };
    }

    const body = (await res.json()) as AnthropicMessageResponse;
    // Anthropic returns content as an array of blocks; we want the first text block.
    const textBlock = (body.content ?? []).find((b) => b.type === 'text' && typeof b.text === 'string');
    const raw = textBlock?.text ?? '';
    const envelope = parseEnvelope(raw);
    const matches = envelope ? envelopeToMatches(envelope, trimmed) : [];
    return { matches, model: config.model, latencyMs: Date.now() - started };
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      // sanitizeError() scrubs the apiKey out of err.message before
      // it hits the log — fetch() can echo the outbound URL/headers
      // verbatim on some failure modes, and that would leak the key.
      console.warn(
        '[provider:anthropic] failed:',
        sanitizeError((err as Error).message, config.apiKey),
      );
    }
    return { ...empty, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
