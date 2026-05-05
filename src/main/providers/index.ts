// ── Provider Dispatcher ─────────────────────────────────────────────────────
// One entry point the rest of the app calls. Takes a StoredProviderConfig
// (the on-disk shape — cloud variants carry only an opaque `keyRef`),
// resolves the keyRef → plaintext apiKey via the Secrets module ONLY for
// the duration of the call, dispatches to the per-provider module, then
// scrubs the local plaintext reference in a finally block.
//
// Per-provider modules (anthropic.ts, openai.ts, gemini.ts) keep their
// existing signatures — they accept a config with `apiKey: string`. The
// migration is dispatcher-level only (anti-pattern §7.4).
//
// Adding a new provider:
//   1. Create providers/<name>.ts implementing {isAvailable, warmup, enrich}
//   2. Add a case in each switch below + matching variant in shared/types
//   3. Add an entry to ALL_PROVIDERS for the settings UI

import type {
  EnrichmentResult,
  ProviderInfo,
} from './types';
import type {
  ResolvedProviderConfig,
  StoredProviderConfig,
} from '../../shared/types';
import * as none from './none';
import * as ollama from './ollama';
import * as anthropic from './anthropic';
import * as openai from './openai';
import * as gemini from './gemini';
import type { Secrets } from '../secrets/secrets';

export type {
  ProviderType,
  EnrichmentResult,
  ProviderInfo,
} from './types';
// Stored shape (with keyRef) is the public contract for callers.
export type { StoredProviderConfig as ProviderConfig } from '../../shared/types';

// ── Secrets registry ───────────────────────────────────────────────────────
// The Store owns the Secrets instance — it's the only thing that needs to
// write encrypted blobs (during migration). The dispatcher needs to *read*
// to resolve keyRefs. Rather than thread a Secrets handle through every
// call site (every store mutation goes through enrichWithProvider), we
// register the handle once at boot from store.ts.
//
// Single-process Electron main makes this safe; the registry is module-
// scoped, never crosses IPC, and is set exactly once.

let secretsHandle: Secrets | null = null;

/** Called once from store.ts during boot, before any enrich is dispatched. */
export function setSecrets(s: Secrets): void {
  secretsHandle = s;
}

// ── Secret resolution ──────────────────────────────────────────────────────

type ResolveResult =
  | { status: 'ok'; cfg: ResolvedProviderConfig }
  | { status: 'error'; message: string };

/**
 * Materialise a ResolvedProviderConfig from a StoredProviderConfig.
 *  - For 'none' / 'ollama': trivial copy, no secret needed.
 *  - For cloud providers: read the encrypted blob via Secrets, decrypt,
 *    return a config that holds the plaintext key for ONE call only.
 *
 * Tolerates an inline `apiKey` field on the input — used by the
 * onboarding wizard's `provider:check` validation flow, which pings
 * isAvailable with a freshly typed key BEFORE it has been persisted /
 * had a keyRef minted. Nothing in this branch hits disk; the inline
 * key lives only on the local config for the duration of one call,
 * then `scrub()` blanks it. (Anti-pattern §7.3 still holds for the
 * persistence path: store.ts will only ever write keyRefs.)
 *
 * Errors return a structured message rather than throwing — the caller
 * surfaces it on EnrichmentResult.error so Free tier can keep running.
 */
async function resolveSecrets(
  stored: StoredProviderConfig & { apiKey?: string },
): Promise<ResolveResult> {
  if (stored.type === 'none') {
    return { status: 'ok', cfg: { type: 'none' } };
  }
  if (stored.type === 'ollama') {
    return {
      status: 'ok',
      cfg: { type: 'ollama', model: stored.model, baseUrl: stored.baseUrl },
    };
  }

  // Validation path: inline apiKey supplied (wizard `provider:check`).
  // No persistence happens here, so there's nothing to encrypt.
  if (typeof stored.apiKey === 'string' && stored.apiKey.length > 0) {
    return {
      status: 'ok',
      cfg: { type: stored.type, apiKey: stored.apiKey, model: stored.model },
    };
  }

  // Stored path: resolve via Secrets.
  if (!secretsHandle) {
    return {
      status: 'error',
      message: 'Secrets module not initialised; cannot resolve provider key.',
    };
  }
  if (!secretsHandle.available()) {
    return {
      status: 'error',
      message:
        'OS keychain unavailable; cloud provider keys cannot be saved on this machine.',
    };
  }
  let plaintext: string | null;
  try {
    plaintext = await secretsHandle.get(stored.keyRef);
  } catch {
    return {
      status: 'error',
      message: 'Failed to read encrypted key from secrets store.',
    };
  }
  if (plaintext === null || plaintext.length === 0) {
    return {
      status: 'error',
      message: `Provider keyRef ${stored.keyRef} not found in secrets store.`,
    };
  }
  return {
    status: 'ok',
    cfg: { type: stored.type, apiKey: plaintext, model: stored.model },
  };
}

/**
 * Best-effort scrub of the plaintext key from a ResolvedProviderConfig
 * after dispatch returns. V8 won't actually purge the original string
 * from the heap — strings are immutable — but overwriting the *named*
 * reference removes it from any future debugger inspect / JSON.stringify
 * of the local cfg object. Cheap defence-in-depth.
 */
function scrub(cfg: ResolvedProviderConfig): void {
  if ('apiKey' in cfg) {
    (cfg as { apiKey?: string }).apiKey = '';
  }
}

function emptyResult(model: string, error: string): EnrichmentResult {
  return { matches: [], model, latencyMs: 0, error };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export async function isProviderAvailable(
  stored: StoredProviderConfig & { apiKey?: string },
): Promise<boolean> {
  const resolved = await resolveSecrets(stored);
  if (resolved.status === 'error') return false;
  try {
    switch (resolved.cfg.type) {
      case 'none':       return none.isAvailable();
      case 'ollama':     return ollama.isAvailable(resolved.cfg);
      case 'anthropic':  return anthropic.isAvailable(resolved.cfg);
      case 'openai':     return openai.isAvailable(resolved.cfg);
      case 'gemini':     return gemini.isAvailable(resolved.cfg);
    }
  } finally {
    scrub(resolved.cfg);
  }
}

export async function warmupProvider(
  stored: StoredProviderConfig & { apiKey?: string },
): Promise<void> {
  const resolved = await resolveSecrets(stored);
  if (resolved.status === 'error') return;
  try {
    switch (resolved.cfg.type) {
      case 'none':       return none.warmup();
      case 'ollama':     return ollama.warmup(resolved.cfg);
      case 'anthropic':  return anthropic.warmup(resolved.cfg);
      case 'openai':     return openai.warmup(resolved.cfg);
      case 'gemini':     return gemini.warmup(resolved.cfg);
    }
  } finally {
    scrub(resolved.cfg);
  }
}

export async function enrichWithProvider(
  content: string,
  stored: StoredProviderConfig & { apiKey?: string },
): Promise<EnrichmentResult> {
  const resolved = await resolveSecrets(stored);
  if (resolved.status === 'error') {
    // Free tier keeps working — only cloud providers need the keychain.
    // We surface the error so the future Settings UI banner can render it.
    const modelLabel =
      stored.type === 'ollama' || stored.type === 'none'
        ? stored.type
        : stored.type;
    return emptyResult(modelLabel, resolved.message);
  }
  try {
    switch (resolved.cfg.type) {
      case 'none':       return await none.enrich();
      case 'ollama':     return await ollama.enrich(content, resolved.cfg);
      case 'anthropic':  return await anthropic.enrich(content, resolved.cfg);
      case 'openai':     return await openai.enrich(content, resolved.cfg);
      case 'gemini':     return await gemini.enrich(content, resolved.cfg);
    }
  } finally {
    scrub(resolved.cfg);
  }
}

// ── Metadata for the settings/onboarding UI ────────────────────────────────
/**
 * Static list describing every provider — used by the onboarding wizard
 * and the settings dropdown to render choices, disable unavailable ones,
 * and surface their requirements (API key vs local daemon).
 */
export const ALL_PROVIDERS: ReadonlyArray<ProviderInfo> = [
  {
    type: 'ollama',
    displayName: 'Ollama',
    tagline: 'Free, runs on your machine. Recommended.',
    implemented: true,
    requiresApiKey: false,
    requiresDaemon: true,
  },
  {
    type: 'anthropic',
    displayName: 'Claude (Anthropic)',
    tagline: 'Highest quality patterns. API key, ~$0.0001/note.',
    implemented: true,
    requiresApiKey: true,
    requiresDaemon: false,
  },
  {
    type: 'openai',
    displayName: 'OpenAI (GPT)',
    tagline: 'Solid quality. API key, ~$0.0001/note.',
    implemented: true,
    requiresApiKey: true,
    requiresDaemon: false,
  },
  {
    type: 'gemini',
    displayName: 'Google Gemini',
    tagline: 'Free tier available. API key.',
    implemented: true,
    requiresApiKey: true,
    requiresDaemon: false,
  },
  {
    type: 'none',
    displayName: 'Lexicon only',
    tagline: 'No AI. Built-in pattern detection still works.',
    implemented: true,
    requiresApiKey: false,
    requiresDaemon: false,
  },
];

/** Default recommended model per provider — seed for the onboarding UI. */
export const DEFAULT_MODELS: Record<Exclude<StoredProviderConfig['type'], 'none'>, string> = {
  ollama: 'phi3.5',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
};
