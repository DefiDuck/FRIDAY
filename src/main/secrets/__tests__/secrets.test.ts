// ── Tests for the secrets module + migration + dispatcher leak audit ──────
// node --test runs against compiled JS in dist/. We inject a fake
// safeStorage so the suite doesn't need Electron to be present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createSecrets,
  SecretsUnavailableError,
  type SafeStorageLike,
} from '../secrets';
import { migrateLegacyApiKey } from '../migrate';
import type { KeyRef, Settings, StoredProviderConfig } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/constants';

// ── Fakes ──────────────────────────────────────────────────────────────────
// `available` toggles isEncryptionAvailable() at runtime — useful for the
// unavailable-path test. encrypt/decrypt do a tagged "rot" so the bytes
// are visibly transformed (catches "we forgot to encrypt" bugs).

function makeSafeStorage(available = true): SafeStorageLike & {
  setAvailable(v: boolean): void;
} {
  let enabled = available;
  return {
    setAvailable(v: boolean) { enabled = v; },
    isEncryptionAvailable: () => enabled,
    encryptString: (plaintext: string) => {
      // Prefix tag so we can assert the on-disk blob isn't the raw plaintext.
      return Buffer.concat([Buffer.from('ENC|', 'utf8'), Buffer.from(plaintext, 'utf8')]);
    },
    decryptString: (encrypted: Buffer) => {
      const s = encrypted.toString('utf8');
      if (!s.startsWith('ENC|')) throw new Error('decrypt: unknown shape');
      return s.slice(4);
    },
  };
}

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'friday-secrets-test-'));
}

// ── Smoke: round-trip ──────────────────────────────────────────────────────
test('secrets: set then get returns the same plaintext', async () => {
  const dir = makeTempDir();
  try {
    const ss = makeSafeStorage();
    const secrets = createSecrets(dir, ss);
    const ref = secrets.newRef('anthropic');
    await secrets.set(ref, 'sk-ant-supersecret1234567890');
    const got = await secrets.get(ref);
    assert.equal(got, 'sk-ant-supersecret1234567890');
    // File exists on disk.
    assert.ok(existsSync(path.join(dir, 'secrets.bin')));
    // The on-disk content is base64 of the encrypted blob — not the plaintext.
    const raw = readFileSync(path.join(dir, 'secrets.bin'), 'utf8');
    assert.equal(raw.includes('sk-ant-'), false, 'plaintext key leaked into secrets.bin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secrets: get returns null for unknown keyRef', async () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const got = await secrets.get('anthropic-key-deadbeef' as KeyRef);
    assert.equal(got, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secrets: delete removes an entry; idempotent', async () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const ref = secrets.newRef('openai');
    await secrets.set(ref, 'sk-openai-keyvalue123456789');
    assert.equal(await secrets.get(ref), 'sk-openai-keyvalue123456789');
    await secrets.delete(ref);
    assert.equal(await secrets.get(ref), null);
    // Second delete is a no-op.
    await secrets.delete(ref);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC #4: isEncryptionAvailable() === false path ─────────────────────────
test('secrets: set throws SecretsUnavailableError when keychain unavailable', async () => {
  const dir = makeTempDir();
  try {
    const ss = makeSafeStorage(false);
    const secrets = createSecrets(dir, ss);
    assert.equal(secrets.available(), false);
    await assert.rejects(
      () => secrets.set('anthropic-key-aaaa' as KeyRef, 'sk-ant-x'),
      (err: unknown) => err instanceof SecretsUnavailableError,
    );
    // store.json equivalent (the secrets.bin) is not created.
    assert.equal(existsSync(path.join(dir, 'secrets.bin')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC #5: migration is idempotent ────────────────────────────────────────
test('migrate: idempotent — second call is a no-op', () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: {
        // Cast to bypass the strict StoredProviderConfig — this represents
        // a v0.1.0 store with plaintext apiKey.
        type: 'anthropic',
        apiKey: 'sk-ant-legacyplaintext1234567890',
        model: 'claude-haiku-4-5',
      } as unknown as StoredProviderConfig,
    };

    const first = migrateLegacyApiKey(settings, secrets);
    assert.equal(first.migrated, true, 'first call must migrate');
    const newProv = first.settings.provider as {
      type: string;
      keyRef?: string;
      apiKey?: string;
      model?: string;
    };
    assert.equal(newProv.type, 'anthropic');
    assert.ok(newProv.keyRef, 'keyRef must be assigned');
    assert.equal('apiKey' in newProv && newProv.apiKey !== undefined, false, 'apiKey must be gone');
    const firstRef = newProv.keyRef!;

    // Second call observes the migrated shape and does nothing.
    const second = migrateLegacyApiKey(first.settings, secrets);
    assert.equal(second.migrated, false, 'second call must be no-op');
    const stillProv = second.settings.provider as { keyRef?: string };
    assert.equal(stillProv.keyRef, firstRef, 'keyRef must be unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate: keychain unavailable leaves store untouched, sets _migration flag', () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage(false));
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: {
        type: 'openai',
        apiKey: 'sk-openai-legacy1234567890',
        model: 'gpt-4o-mini',
      } as unknown as StoredProviderConfig,
    };

    const result = migrateLegacyApiKey(settings, secrets);
    assert.equal(result.migrated, false, 'must NOT migrate when keychain unavailable');
    assert.ok(result.warnings.length > 0, 'must warn');
    // _migration flag set on returned settings (in-memory hint for UI).
    const flag = (result.settings as Settings & {
      _migration?: { status: string; reason: string };
    })._migration;
    assert.ok(flag, '_migration flag must be set');
    assert.equal(flag.status, 'blocked');
    assert.equal(flag.reason, 'keychain_unavailable');
    // Original apiKey is still on the (returned) settings — caller will
    // not persist because migrated === false.
    const prov = result.settings.provider as { apiKey?: string };
    assert.equal(prov.apiKey, 'sk-openai-legacy1234567890');
    // Crucially: secrets.bin not created.
    assert.equal(existsSync(path.join(dir, 'secrets.bin')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate: partial-migration recovery (apiKey + keyRef both present)', () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: {
        type: 'anthropic',
        keyRef: 'anthropic-key-aaaa' as KeyRef,
        apiKey: 'sk-ant-stalecopy1234567890',
        model: 'claude-haiku-4-5',
      } as unknown as StoredProviderConfig,
    };
    const result = migrateLegacyApiKey(settings, secrets);
    assert.equal(result.migrated, true);
    const prov = result.settings.provider as { keyRef?: string; apiKey?: string };
    assert.equal(prov.keyRef, 'anthropic-key-aaaa', 'existing keyRef preserved');
    assert.equal(prov.apiKey, undefined, 'stale plaintext dropped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate: no-op for non-cloud provider', () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: { type: 'ollama', model: 'phi3.5' },
    };
    const result = migrateLegacyApiKey(settings, secrets);
    assert.equal(result.migrated, false);
    assert.deepEqual(result.settings.provider, { type: 'ollama', model: 'phi3.5' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC #3: no log line contains a plaintext key ───────────────────────────
test('audit: forced-failure paths in providers do not log the plaintext key', async () => {
  const KEY = 'sk-faketest1234567890abcdefghi'; // matches /sk-[A-Za-z0-9]{20,}/
  const captured: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const cap = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.log = cap;
  console.warn = cap;
  console.error = cap;

  // Force fetch to fail — message includes the key so any naive log of
  // err.message would leak it. We assert the providers do NOT do that.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(`network broken; tried to send ${KEY} to api`);
  };

  try {
    const anthropic = await import('../../providers/anthropic');
    const openai = await import('../../providers/openai');
    const gemini = await import('../../providers/gemini');

    await anthropic.enrich('test note content here', {
      type: 'anthropic',
      apiKey: KEY,
      model: 'claude-haiku-4-5',
    });
    await openai.enrich('test note content here', {
      type: 'openai',
      apiKey: KEY,
      model: 'gpt-4o-mini',
    });
    await gemini.enrich('test note content here', {
      type: 'gemini',
      apiKey: KEY,
      model: 'gemini-1.5-flash',
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    globalThis.fetch = origFetch;
  }

  const all = captured.join('\n');
  // The narrow regex from work-order AC #3.
  const leak = all.match(/sk-[a-zA-Z0-9]{20,}/);
  assert.equal(
    leak,
    null,
    `plaintext key leaked into logs: ${leak?.[0]}\nfull log:\n${all}`,
  );
});

test('redact(): wipes apiKey for safe debug logging', async () => {
  const { redact } = await import('../../providers/shared');
  const cfg = {
    type: 'anthropic' as const,
    apiKey: 'sk-ant-thisshouldbehidden1234567890',
    model: 'claude-haiku-4-5',
  };
  const safe = redact(cfg);
  assert.equal(safe.apiKey, '***REDACTED***');
  // Original is untouched (callers may still need it).
  assert.equal(cfg.apiKey, 'sk-ant-thisshouldbehidden1234567890');
  assert.equal(JSON.stringify(safe).includes('sk-ant-'), false);
});

// ── AC #4 follow-on: dispatcher returns clean error result ────────────────
test('dispatcher: enrichWithProvider returns error result when keychain unavailable', async () => {
  const dir = makeTempDir();
  try {
    // Simulate boot path: store registers a secrets handle whose
    // available() returns false, then dispatch tries to enrich.
    const secrets = createSecrets(dir, makeSafeStorage(false));
    const { setSecrets, enrichWithProvider } = await import('../../providers');
    setSecrets(secrets);

    const result = await enrichWithProvider('a journal note', {
      type: 'anthropic',
      keyRef: 'anthropic-key-zzzz' as KeyRef,
      model: 'claude-haiku-4-5',
    });
    assert.deepEqual(result.matches, []);
    assert.ok(result.error, 'expected an error message');
    assert.match(
      result.error!,
      /keychain unavailable/i,
      `unexpected error: ${result.error}`,
    );

    // store.json equivalent on disk: the secrets.bin must NOT have been
    // created (we never wrote anything).
    assert.equal(existsSync(path.join(dir, 'secrets.bin')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC #1 surrogate: store rewrite removes plaintext on first migrate ─────
// We can't boot the real Store class without Electron's `app`, so this
// test exercises the migrate function directly against a hand-constructed
// settings object — proving the algorithm produces a key-free settings
// shape ready for the caller to persist.
test('AC #1 surrogate: migrated settings serialise with no plaintext key', () => {
  const dir = makeTempDir();
  try {
    const secrets = createSecrets(dir, makeSafeStorage());
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: {
        type: 'gemini',
        apiKey: 'sk-gemini-abcdef1234567890ZZZ',
        model: 'gemini-1.5-flash',
      } as unknown as StoredProviderConfig,
    };
    const result = migrateLegacyApiKey(settings, secrets);
    assert.equal(result.migrated, true);
    const serialised = JSON.stringify(result.settings, null, 2);
    // Write to a fake store.json and grep for sk-.
    const storePath = path.join(dir, 'store.json');
    writeFileSync(storePath, serialised, 'utf8');
    const onDisk = readFileSync(storePath, 'utf8');
    assert.equal(onDisk.includes('sk-gemini-'), false, 'plaintext key present in store.json');
    assert.equal(onDisk.includes('keyRef'), true, 'keyRef must be present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
