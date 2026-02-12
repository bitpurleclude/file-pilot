import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export const saveCredentialFallback = async (path: string, value: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(encrypt(value), null, 2), "utf-8");
};

export const readCredentialFallback = async (path: string): Promise<string | null> => {
  try {
    const raw = await readFile(path, "utf-8");
    const payload = JSON.parse(raw) as EncryptedPayload;
    return decrypt(payload);
  } catch {
    return null;
  }
};
