import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

interface EncryptedPayload {
  version: number;
  iv: string;
  tag: string;
  encrypted: string;
}

const keyFromMachine = (): Buffer => {
  const seed = `${process.platform}:${process.arch}:${process.env.USERNAME ?? "unknown"}`;
  return createHash("sha256").update(seed).digest();
};

const encrypt = (plain: string): EncryptedPayload => {
  const key = keyFromMachine();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    encrypted: encrypted.toString("base64")
  };
};

const decrypt = (payload: EncryptedPayload): string => {
  const key = keyFromMachine();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const encrypted = Buffer.from(payload.encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf-8");
};

/**
 * Encrypts a single value into a self-contained storage string
 * (serialized AES-256-GCM payload). Machine-bound key, pure Node.
 */
export const encryptValue = (plain: string): string => JSON.stringify(encrypt(plain));

/**
 * Decrypts a storage string produced by encryptValue.
 * Returns null for malformed or tampered input (auth tag mismatch).
 */
export const decryptValue = (stored: string): string | null => {
  try {
    const payload = JSON.parse(stored) as EncryptedPayload;
    return decrypt(payload);
  } catch {
    return null;
  }
};
