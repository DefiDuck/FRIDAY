// ── Google Gemini Provider ─────────────────────────────────────────────────
// Gemini generateContent API. User-owned key; never proxied.
//
// Recommended models:
//   gemini-1.5-flash  — fast + cheap (default)
//   gemini-1.5-pro    — better nuance

import type { GeminiConfig, EnrichmentResult } from './types';
import { ENRICHMENT_TIMEOUT_MS } from '../../shared/constants';
import { buildPrompt, parseEnvelope, envelopeToMatches, sanitizeError } from './shared';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export async function isAvailable(config: GeminiConfig): Promise<boolean> {
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 10;
}

export async function warmup(_config: GeminiConfig): Promise<void> {
  // no-op — cloud API
}

export async function enrich(
  content: string,
  config: GeminiConfig,
): Promise<EnrichmentResult> {
  const started = Date.now();
  const empty: EnrichmentResult = { matches: [], model: config.model, latencyMs: 0 };

  const trimmed = content.trim();
  if (trimmed.length < 3) return empty;
  if (!config.apiKey || config.apiKey.length < 10) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  try {
    const url = `${GEMINI_API_URL}/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(trimmed) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
        systemInstruction: {
          parts: [
            {
              text:
                'You extract behavioural patterns from a trader\u2019s journal. ' +
                'Always return valid JSON only, no prose.',
            },
          ],
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn('[provider:gemini] http', res.status);
      return { ...empty, latencyMs: Date.now() - started };
    }

    const body = (await res.json()) as GeminiGenerateResponse;
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const envelope = parseEnvelope(raw);
    const matches = envelope ? envelopeToMatches(envelope, trimmed) : [];
    return { matches, model: config.model, latencyMs: Date.now() - started };
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      // Gemini puts the key in the URL query string (?key=...), so URL
      // echoes in error messages are an especially likely leak vector.
      console.warn(
        '[provider:gemini] failed:',
        sanitizeError((err as Error).message, config.apiKey),
      );
    }
    return { ...empty, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
