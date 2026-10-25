import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Provider API key 编解码器
 *
 * settings.json 中不再落明文 key：加密值带 `enc:v1:` 前缀。
 * 主进程优先使用 Electron safeStorage（见 real-main 的装配），
 * 无 Electron 环境回退到机器绑定 AES-GCM（混淆级，不依赖明文等价）。
 * 历史明文值不带前缀，解密时原样透传，下次保存时加密——平滑迁移。
 */

export const ENCRYPTED_KEY_PREFIX = "enc:v1:";

export interface ProviderKeyCodec {
  /** 加密明文 key；返回带前缀的可持久化字符串。 */
  encrypt(plain: string): string;
  /**
   * 解密已存储值。识别到受支持前缀则解密（失败返回 null，调用方应丢弃该 key）；
   * 未带前缀的历史明文原样返回。
   */
  decrypt(stored: string): string | null;
}

export const isEncryptedKeyValue = (value: string | undefined): boolean => {
  return value !== undefined && value.startsWith(ENCRYPTED_KEY_PREFIX);
};

export const PLAINTEXT_CODEC: ProviderKeyCodec = {
  encrypt: (plain) => plain,
  decrypt: (stored) => stored
};

const machineKey = (): Buffer => {
  const seed = `${process.platform}:${process.arch}:${process.env.USERNAME ?? "unknown"}`;
  return createHash("sha256").update(seed).digest();
};

/** 机器绑定 AES-256-GCM 回退编解码（无 safeStorage 时使用）。 */
export const createMachineBoundCodec = (): ProviderKeyCodec => {
  const prefix = `${ENCRYPTED_KEY_PREFIX}aes:`;

  return {
    encrypt: (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", machineKey(), iv);
      const encrypted = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${prefix}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
    },
    decrypt: (stored) => {
      if (!stored.startsWith(prefix)) {
        return stored;
      }

      try {
        const [ivPart, tagPart, dataPart] = stored.slice(prefix.length).split(":");
        if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
          return null;
        }

        const decipher = createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(ivPart, "base64"));
        decipher.setAuthTag(Buffer.from(tagPart, "base64"));
        const plain = Buffer.concat([
          decipher.update(Buffer.from(dataPart, "base64")),
          decipher.final()
        ]);
        return plain.toString("utf-8");
      } catch {
        return null;
      }
    }
  };
};
