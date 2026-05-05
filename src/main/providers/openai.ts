// ── OpenAI Provider ────────────────────────────────────────────────────────
// Chat Completions API. User-owned key; never proxied.
//
// Recommended models:
//   gpt-4o-mini  — fast + cheap (default for this kind of structured task)
//   gpt-4o       — better nuance, ~15x the cost per note

import type { OpenAIConfig, EnrichmentResult } from './types';
import { ENRICHMENT_TIMEOUT_MS } from '../../shared/constants';
import { buildPrompt, parseEnvelope, envelopeToMatches, sanitizeError } from './shared';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

export async function isAvailable(config: OpenAIConfig): Promise<boolean> {
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 10;
}

export async function warmup(_config: OpenAIConfig): Promise<void> {
  // no-op — cloud API
}

export async function enrich(
  content: string,
  config: OpenAIConfig,
): Promise<EnrichmentResult> {
  const started = Date.now();
  const empty: EnrichmentResult = { matches: [], model: config.model, latencyMs: 0 };

  const trimmed = content.trim();
  if (trimmed.length < 3) return empty;
  if (!config.apiKey || config.apiKey.length < 10) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 512,
        // response_format forces valid JSON from the model.
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You extract behavioural patterns from a trader\u2019s journal. ' +
              'Always return valid JSON only, no prose.',
          },
          {
            role: 'user',
            content: buildPrompt(trimmed),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn('[provider:openai] http', res.status);
      return { ...empty, latencyMs: Date.now() - started };
    }

    const body = (await res.json()) as OpenAIChatResponse;
    const raw = body.choices?.[0]?.message?.content ?? '';
    const envelope = parseEnvelope(raw);
    const matches = envelope ? envelopeToMatches(envelope, trimmed) : [];
    return { matches, model: config.model, latencyMs: Date.now() - started };
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      // See anthropic.ts for the sanitize rationale.
      console.warn(
        '[provider:openai] failed:',
        sanitizeError((err as Error).message, config.apiKey),
      );
    }
    return { ...empty, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
