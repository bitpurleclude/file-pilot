import { createCredentialFileStorage } from "./credential-storage.js";

/**
 * Credential storage abstraction consumed by the settings repository.
 *
 * Failure contract: credential persistence is a best-effort side channel and
 * must never block settings save/load. All operations swallow errors —
 * load returns null, save/remove resolve silently. The default implementation
 * reports unexpected save/remove failures through console.warn (without any
 * secret material in the message).
 */
export interface SettingsCredentialStore {
  save(apiKey: string, providerId: string): Promise<void>;
  load(providerId: string): Promise<string | null>;
  remove(providerId: string): Promise<void>;
}

const warnFailure = (operation: string, providerId: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[settings-credentials] ${operation} failed for provider "${providerId}": ${message}`);
};

/**
 * Default credential store backed by an encrypted JSON file under
 * credentialsDir (one record per provider id). Prefers Electron safeStorage
 * and degrades to the pure Node AES-256-GCM fallback from credential-store.ts
 * when Electron-level encryption is unavailable (including plain Node runtimes).
 */
export const createFileCredentialStore = (credentialsDir: string): SettingsCredentialStore => {
  const storage = createCredentialFileStorage(credentialsDir);

  return {
    save: async (apiKey, providerId) => {
      try {
        await storage.save(apiKey, providerId);
      } catch (error) {
        warnFailure("save", providerId, error);
      }
    },
    load: async (providerId) => {
      try {
        return await storage.load(providerId);
      } catch (error) {
        warnFailure("load", providerId, error);
        return null;
      }
    },
    remove: async (providerId) => {
      try {
        await storage.remove(providerId);
      } catch (error) {
        warnFailure("remove", providerId, error);
      }
    }
  };
};
