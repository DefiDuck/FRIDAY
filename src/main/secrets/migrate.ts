// ── Legacy plaintext apiKey → keyRef migration ──────────────────────────────
// One-shot, idempotent. Called from store.ts → load() right after the
// existing schema migrations and BEFORE persist(), so the rewritten
// settings hit disk in the post-migration shape on first launch of
// v0.1.1 against a v0.1.0 store.json.
//
// Per work-order §3.3:
//   • If provider has top-level `apiKey: string` AND no `keyRef`:
//       - secrets available  → encrypt + replace + persist
//       - secrets unavailable → leave store.json untouched, set a
//         `_migration` flag on settings so the future Settings UI can
//         render a remediation banner
//   • If both `apiKey` and `keyRef` exist (partial migration from a
//     crash mid-write): drop the apiKey, keep the keyRef
//   • If only `keyRef` exists: no-op (already migrated)
//   • Idempotency: a second call observes no apiKey and returns no-op

import type { Settings, KeyRef, StoredProviderConfig } from '../../shared/types';
import type { SecretsImpl } from './secrets';

/**
 * Sidecar field stamped onto Settings when migration is blocked. Not part
 * of the persisted Settings type — added here as an in-memory hint that
 * the future Settings UI can read via getSettings(). Persists harmlessly
 * if it round-trips through store.json (unknown field).
 */
export interface MigrationFlag {
  status: 'blocked';
  reason: 'keychain_unavailable';
}

export interface MigrationResult {
  /** True if settings were structurally changed (caller should persist). */
  migrated: boolean;
  /** Possibly-rewritten settings. Always returned — caller assigns wholesale. */
  settings: Settings;
  /** Human-readable warnings for the structured log. */
  warnings: string[];
}

/**
 * Inspect `settings.provider`. If the v0.1.0 plaintext `apiKey` field
 * is present and we can encrypt, replace it with a fresh `keyRef` and
 * tell the caller to persist. Otherwise no-op.
 *
 * Strictly synchronous: safeStorage and the underlying Secrets file
 * are sync, and the call site (store.ts → load()) is sync.
 */
export function migrateLegacyApiKey(
  settings: Settings,
  secrets: SecretsImpl,
): MigrationResult {
  const provider = settings.provider as StoredProviderConfig & {
    apiKey?: unknown;
    keyRef?: unknown;
  };
  const warnings: string[] = [];

  // Not a cloud provider, or no provider — nothing to migrate.
  if (
    !provider ||
    (provider.type !== 'anthropic' &&
      provider.type !== 'openai' &&
      provider.type !== 'gemini')
  ) {
    return { migrated: false, settings, warnings };
  }

  const hasPlaintext =
    typeof provider.apiKey === 'string' && (provider.apiKey as string).length > 0;
  const hasKeyRef =
    typeof provider.keyRef === 'string' && (provider.keyRef as string).length > 0;

  // Already migrated — no apiKey to worry about.
  if (!hasPlaintext) return { migrated: false, settings, warnings };

  // Partial migration recovery: keyRef present alongside apiKey
  // (v0.1.1 crashed between secrets.set and persist). Drop apiKey,
  // trust the existing keyRef.
  if (hasKeyRef) {
    warnings.push(
      `partial migration recovery for ${provider.type}: dropping stale plaintext apiKey, keeping existing keyRef`,
    );
    const cleaned: StoredProviderConfig = {
      type: provider.type,
      keyRef: provider.keyRef as KeyRef,
      model: (provider as { model: string }).model,
    };
    return {
      migrated: true,
      settings: { ...settings, provider: cleaned },
      warnings,
    };
  }

  // Refuse to silently fall back to plaintext (anti-pattern §7.3).
  if (!secrets.available()) {
    warnings.push(
      'safeStorage unavailable; legacy plaintext apiKey left in store.json. ' +
        'Cloud provider will not be usable until OS keychain is reachable.',
    );
    const flagged = {
      ...settings,
      _migration: { status: 'blocked', reason: 'keychain_unavailable' } as MigrationFlag,
    } as Settings;
    return { migrated: false, settings: flagged, warnings };
  }

  // Happy path: encrypt + replace.
  const providerType = provider.type;
  const keyRef = secrets.newRef(providerType);
  secrets.setSync(keyRef, provider.apiKey as string);

  const newProvider: StoredProviderConfig = {
    type: providerType,
    keyRef,
    model: (provider as { model: string }).model,
  };
  warnings.push(
    `migrated plaintext ${providerType} apiKey → encrypted ${keyRef}`,
  );
  return {
    migrated: true,
    settings: { ...settings, provider: newProvider },
    warnings,
  };
}
