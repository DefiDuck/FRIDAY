// ── F.R.I.D.A.Y. Secrets Module ─────────────────────────────────────────────
// Wraps Electron's safeStorage (DPAPI on Windows / Keychain on macOS) so
// API keys never touch disk in plaintext. The store.json holds only
// opaque keyRefs (e.g. "anthropic-key-7f3a"); the encrypted blobs live
// in `secrets.bin` next to it, written atomically.
//
// Single audit point: this is the ONLY file that calls
// safeStorage.encryptString / decryptString. Anti-pattern §7.2 — never
// reach around it.
//
// Sync internals: safeStorage and fs are both sync, so the underlying
// operations are sync. The Promise-based public API in the `Secrets`
// interface (per work-order §5) wraps these. Boot-time migration uses
// the sync methods directly via the concrete `SecretsImpl` type so it
// can stay inside the existing synchronous Store.load() flow without
// propagating async up the stack.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { KeyRef } from '../../shared/types';

// ── Public types ────────────────────────────────────────────────────────────

export class SecretsUnavailableError extends Error {
  constructor(
    message = 'OS keychain (safeStorage) is unavailable on this machine.',
  ) {
    super(message);
    this.name = 'SecretsUnavailableError';
  }
}

/** The thin slice of Electron's safeStorage we actually use. Injecting
 *  it (rather than importing 'electron' here) keeps this module testable
 *  in plain Node — the test suite passes a fake. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Public Secrets API (per §5). Promise-based for forward compatibility
 *  with the eventual P4b Settings UI flow. */
export interface Secrets {
  available(): boolean;
  set(keyRef: KeyRef, plaintext: string): Promise<void>;
  get(keyRef: KeyRef): Promise<string | null>;
  delete(keyRef: KeyRef): Promise<void>;
  newRef(providerType: 'anthropic' | 'openai' | 'gemini'): KeyRef;
}

// ── On-disk file shape ──────────────────────────────────────────────────────

interface SecretsFile {
  version: 1;
  /** keyRef → base64(safeStorage.encryptString(plaintext)). */
  entries: Record<string, string>;
}

const FILENAME = 'secrets.bin';

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Concrete implementation. Returned as the actual class type (rather
 * than the `Secrets` interface) from `createSecrets` so the boot-time
 * migration in `migrate.ts` can use the sync helpers without pulling
 * `await` into the synchronous Store.load() path.
 */
export class SecretsImpl implements Secrets {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  // ── Public sync helpers (used by migrate.ts) ──────────────────────────

  available(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      // Defensive — older Linux setups can throw rather than return false.
      return false;
    }
  }

  /** True if `secrets.bin` exists on disk (independent of availability). */
  fileExists(): boolean {
    return existsSync(this.filePath);
  }

  setSync(keyRef: KeyRef, plaintext: string): void {
    if (!this.available()) throw new SecretsUnavailableError();
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('refusing to store empty plaintext');
    }
    const file = this.readFile();
    const encrypted = this.safeStorage.encryptString(plaintext);
    file.entries[keyRef] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getSync(keyRef: KeyRef): string | null {
    if (!this.available()) throw new SecretsUnavailableError();
    const file = this.readFile();
    const b64 = file.entries[keyRef];
    if (typeof b64 !== 'string' || b64.length === 0) return null;
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return null;
    }
    try {
      return this.safeStorage.decryptString(buf);
    } catch {
      // Stale entry from a different DPAPI context (e.g. user profile
      // restored from another machine). Surface as null so the caller
      // can prompt for a fresh key, rather than crashing the dispatch.
      return null;
    }
  }

  deleteSync(keyRef: KeyRef): void {
    const file = this.readFile();
    if (!(keyRef in file.entries)) return;
    delete file.entries[keyRef];
    this.writeFile(file);
  }

  newRef(providerType: 'anthropic' | 'openai' | 'gemini'): KeyRef {
    // 4 hex chars = 65,536 keyspace; collision check + retry handles the
    // pathological case. Most users will have one cloud key total.
    let attempts = 0;
    // Read once — newRef is called rarely and the file is tiny.
    const file = this.readFile();
    while (attempts < 32) {
      const hex = randomBytes(2).toString('hex');
      const ref = `${providerType}-key-${hex}` as KeyRef;
      if (!(ref in file.entries)) return ref;
      attempts++;
    }
    throw new Error('secrets.newRef: 32 collisions in a row — file may be corrupt');
  }

  // ── Promise-based public API (per §5) ─────────────────────────────────

  async set(keyRef: KeyRef, plaintext: string): Promise<void> {
    this.setSync(keyRef, plaintext);
  }

  async get(keyRef: KeyRef): Promise<string | null> {
    return this.getSync(keyRef);
  }

  async delete(keyRef: KeyRef): Promise<void> {
    this.deleteSync(keyRef);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private readFile(): SecretsFile {
    if (!existsSync(this.filePath)) return { version: 1, entries: {} };
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      // §7.8 — never crash startup on corrupt secrets. Log + degrade.
      console.warn('[secrets] read failed:', (err as Error).message);
      return { version: 1, entries: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[secrets] parse failed; starting empty file');
      return { version: 1, entries: {} };
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { version?: unknown }).version === 1 &&
      (parsed as { entries?: unknown }).entries &&
      typeof (parsed as { entries?: unknown }).entries === 'object'
    ) {
      return parsed as SecretsFile;
    }
    console.warn('[secrets] unexpected file shape; starting empty');
    return { version: 1, entries: {} };
  }

  private writeFile(file: SecretsFile): void {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), 'utf8');
    renameSync(tmp, this.filePath);
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Construct a Secrets instance backed by `<userDataDir>/secrets.bin` and
 * the supplied safeStorage implementation. Returns the concrete class so
 * the boot-time migration can use sync helpers. External call sites
 * (future Settings UI) should narrow to the `Secrets` interface.
 */
export function createSecrets(
  userDataDir: string,
  safeStorage: SafeStorageLike,
): SecretsImpl {
  const filePath = path.join(userDataDir, FILENAME);
  return new SecretsImpl(filePath, safeStorage);
}
