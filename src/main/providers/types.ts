// ── Provider Interface ──────────────────────────────────────────────────────
// A "provider" is an AI backend F.R.I.D.A.Y. can hand a note to and get
// behavioural pattern matches back. Each provider lives in its own module
// and exports the three functions below. The dispatcher in
// providers/index.ts selects one based on user settings.
//
// Design goals:
//   • Adding a new provider is one file + one case in the dispatcher.
//   • Providers are pure functions over their own config — no globals, no
//     singletons, easy to swap and test.
//   • Never throws up the stack. A dead provider degrades to "no matches"
//     so the lexicon layer always still renders.

import type { NoteEnrichmentMatch } from '../../shared/types';

// ── Per-provider config shapes ─────────────────────────────────────────────
// Discriminated union keyed by `type`. Adding a provider = adding a member.

export interface NoneConfig {
  type: 'none';
}

export interface OllamaConfig {
  type: 'ollama';
  /** Ollama model tag, e.g. "phi3.5", "qwen2.5:3b". */
  model: string;
  /** Daemon URL; omit to use the default http://localhost:11434. */
  baseUrl?: string;
}

export interface AnthropicConfig {
  type: 'anthropic';
  apiKey: string;
  /** API model id, e.g. "claude-haiku-4-5", "claude-sonnet-4-5". */
  model: string;
}

export interface OpenAIConfig {
  type: 'openai';
  apiKey: string;
  /** API model id, e.g. "gpt-4o-mini", "gpt-4o". */
  model: string;
}

export interface GeminiConfig {
  type: 'gemini';
  apiKey: string;
  /** API model id, e.g. "gemini-1.5-flash", "gemini-1.5-pro". */
  model: string;
}

/**
 * Internal alias for the apiKey-bearing union — i.e. what each per-provider
 * `enrich()` actually accepts. Equivalent to `ResolvedProviderConfig` from
 * shared/types.ts; kept here so the per-provider files don't have to
 * import from shared/. Never persisted, never crosses IPC.
 */
export type ProviderConfig =
  | NoneConfig
  | OllamaConfig
  | AnthropicConfig
  | OpenAIConfig
  | GeminiConfig;

/** Short string used in settings UI and log prefixes. */
export type ProviderType = ProviderConfig['type'];

// ── Shared result shape ────────────────────────────────────────────────────
export interface EnrichmentResult {
  matches: NoteEnrichmentMatch[];
  /** Descriptor of what produced these matches — "phi3.5", "claude-haiku-4-5", etc. */
  model: string;
  /** Wall-clock latency in ms, for logs / slow-path warnings. */
  latencyMs: number;
  /**
   * Set ONLY by the dispatcher (providers/index.ts) when it cannot
   * resolve a cloud provider's keyRef — typically because the OS
   * keychain (safeStorage) is unavailable on this machine. Per-provider
   * modules never set this; they degrade silently to empty matches on
   * their own internal errors. The Free tier (Ollama, None) ignores it.
   */
  error?: string;
}

// ── Provider metadata for UI ───────────────────────────────────────────────
export interface ProviderInfo {
  type: ProviderType;
  /** Human-readable name for the onboarding/settings dropdown. */
  displayName: string;
  /** One-line tagline shown beneath the name in the UI. */
  tagline: string;
  /** Is this provider actually wired up, or just a stub pending implementation? */
  implemented: boolean;
  /** Does this provider require a network connection + API key? */
  requiresApiKey: boolean;
  /** Does this provider require an external daemon (Ollama)? */
  requiresDaemon: boolean;
}
