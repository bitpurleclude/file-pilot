import { describe, expect, it } from "vitest";

import {
  createMachineBoundCodec,
  ENCRYPTED_KEY_PREFIX,
  isEncryptedKeyValue,
  PLAINTEXT_CODEC
} from "../../infra/security/provider-key-codec.js";

describe("provider-key-codec", () => {
  it("machine-bound codec round-trips a key", () => {
    const codec = createMachineBoundCodec();
    const encrypted = codec.encrypt("sk-secret-123");

    expect(encrypted.startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true);
    expect(encrypted).not.toContain("sk-secret-123");
    expect(codec.decrypt(encrypted)).toBe("sk-secret-123");
  });

  it("detects encrypted values", () => {
    const codec = createMachineBoundCodec();
    expect(isEncryptedKeyValue(codec.encrypt("x"))).toBe(true);
    expect(isEncryptedKeyValue("plain-key")).toBe(false);
    expect(isEncryptedKeyValue(undefined)).toBe(false);
  });

  it("passes legacy plaintext through unchanged", () => {
    const codec = createMachineBoundCodec();
    expect(codec.decrypt("legacy-plain-key")).toBe("legacy-plain-key");
  });

  it("returns null for tampered ciphertext", () => {
    const codec = createMachineBoundCodec();
    const encrypted = codec.encrypt("sk-secret-123");
    const tampered = encrypted.slice(0, -4) + "AAAA";

    expect(codec.decrypt(tampered)).toBeNull();
  });

  it("plaintext codec is identity", () => {
    expect(PLAINTEXT_CODEC.encrypt("k")).toBe("k");
    expect(PLAINTEXT_CODEC.decrypt("k")).toBe("k");
  });
});
