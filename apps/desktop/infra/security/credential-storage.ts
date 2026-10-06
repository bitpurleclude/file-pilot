import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { decryptValue, encryptValue } from "./credential-store.js";

/**
 * Electron-aware credential file storage.
 *
 * Strategy:
 * 1. Prefer Electron safeStorage (OS-level encryption) when available.
 * 2. Fall back to the pure Node AES-256-GCM implementation in credential-store.ts.
 * 3. The credentials file lives under an explicit, injectable credentialsDir
 *    (no dependency on app.getPath at import or call time), and keeps one
 *    encrypted record per provider id so multiple providers can persist keys
 *    side by side via read-modify-write.
 * 4. The file payload is versioned for future migrations.
 *
 * This module is safe to import and call from a pure Node runtime (vitest):
 * the electron module is resolved lazily via dynamic import inside a try/catch,
 * so a missing or stub electron implementation degrades to the AES-GCM fallback.
 */

const CREDENTIALS_FILE_VERSION = 1;
const CREDENTIALS_FILE_NAME = "credentials.json";

export type CredentialEncryptionMethod = "safeStorage" | "aes-gcm";

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(buffer: Buffer): string;
}

interface CredentialRecord {
  method: CredentialEncryptionMethod;
  /** safeStorage: base64 ciphertext; aes-gcm: serialized AES-256-GCM payload. */
  data: string;
}

interface CredentialFilePayload {
  version: number;
  credentials: Record<string, CredentialRecord>;
}

export interface CredentialStorage {
  save(apiKey: string, providerId: string): Promise<void>;
  load(providerId: string): Promise<string | null>;
  remove(providerId: string): Promise<void>;
  getEncryptionMethod(): Promise<CredentialEncryptionMethod>;
}

const emptyPayload = (): CredentialFilePayload => ({
  version: CREDENTIALS_FILE_VERSION,
  credentials: {}
});

const isSafeStorageLike = (value: unknown): value is SafeStorageLike => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SafeStorageLike>;
  return (
    typeof candidate.isEncryptionAvailable === "function"
    && typeof candidate.encryptString === "function"
    && typeof candidate.decryptString === "function"
  );
};

/**
 * Resolves the Electron safeStorage API without breaking pure Node runtimes:
 * under vitest `import("electron")` either resolves to the npm stub (which has
 * no safeStorage) or rejects entirely; both paths return null and callers
 * degrade to the AES-GCM fallback. Under the Electron main process the real
 * safeStorage module is returned when OS-level encryption is available.
 */
const probeSafeStorage = async (): Promise<SafeStorageLike | null> => {
  try {
    const electronModule = (await import("electron")) as unknown as {
      safeStorage?: unknown;
      default?: { safeStorage?: unknown };
    };
    const candidates: unknown[] = [electronModule.safeStorage, electronModule.default?.safeStorage];
    for (const candidate of candidates) {
      if (!isSafeStorageLike(candidate)) {
        continue;
      }
      if (candidate.isEncryptionAvailable()) {
        return candidate;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
};

const readPayload = async (filePath: string): Promise<CredentialFilePayload> => {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CredentialFilePayload> | null;
    if (
      parsed === null
      || parsed.version !== CREDENTIALS_FILE_VERSION
      || parsed.credentials === undefined
      || parsed.credentials === null
      || typeof parsed.credentials !== "object"
    ) {
      return emptyPayload();
    }
    return { version: CREDENTIALS_FILE_VERSION, credentials: parsed.credentials };
  } catch {
    return emptyPayload();
  }
};

const writePayload = async (
  credentialsDir: string,
  filePath: string,
  payload: CredentialFilePayload
): Promise<void> => {
  await mkdir(credentialsDir, { recursive: true });
  // Atomic write via temp file + rename: a crash or concurrent save must never
  // leave a truncated credentials file behind (it would read back as empty and
  // the next save would wipe the remaining provider keys).
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const encryptRecord = async (plaintext: string): Promise<CredentialRecord> => {
  const safeStorage = await probeSafeStorage();
  if (safeStorage !== null) {
    return { method: "safeStorage", data: safeStorage.encryptString(plaintext).toString("base64") };
  }
  return { method: "aes-gcm", data: encryptValue(plaintext) };
};

const decryptRecord = async (record: CredentialRecord): Promise<string | null> => {
  try {
    if (record.method === "safeStorage") {
      const safeStorage = await probeSafeStorage();
      if (safeStorage === null) {
        return null;
      }
      return safeStorage.decryptString(Buffer.from(record.data, "base64"));
    }
    if (record.method === "aes-gcm") {
      return decryptValue(record.data);
    }
    return null;
  } catch {
    return null;
  }
};

export const createCredentialFileStorage = (credentialsDir: string): CredentialStorage => {
  const filePath = join(credentialsDir, CREDENTIALS_FILE_NAME);

  const persistWithoutProvider = async (providerId: string): Promise<void> => {
    const payload = await readPayload(filePath);
    if (payload.credentials[providerId] === undefined) {
      return;
    }
    delete payload.credentials[providerId];
    await writePayload(credentialsDir, filePath, payload);
  };

  const save = async (apiKey: string, providerId: string): Promise<void> => {
    if (apiKey.length === 0) {
      await persistWithoutProvider(providerId);
      return;
    }
    const record = await encryptRecord(apiKey);
    const payload = await readPayload(filePath);
    payload.credentials[providerId] = record;
    await writePayload(credentialsDir, filePath, payload);
  };

  const load = async (providerId: string): Promise<string | null> => {
    const payload = await readPayload(filePath);
    const record = payload.credentials[providerId];
    if (record === undefined) {
      return null;
    }
    return decryptRecord(record);
  };

  const remove = async (providerId: string): Promise<void> => {
    await persistWithoutProvider(providerId);
  };

  const getEncryptionMethod = async (): Promise<CredentialEncryptionMethod> => {
    const safeStorage = await probeSafeStorage();
    return safeStorage !== null ? "safeStorage" : "aes-gcm";
  };

  return { save, load, remove, getEncryptionMethod };
};
