import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { app } from "electron";

/**
 * 凭据存储模块
 * 
 * 策略：
 * 1. 优先使用 Electron safeStorage API（系统级加密）
 * 2. 不可用时回退到 AES-GCM 本地加密文件
 * 3. 使用机器绑定密钥（基于 machineId）
 * 4. 支持密钥版本管理
 */

const CREDENTIAL_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 加密凭据数据结构
 */
interface EncryptedCredential {
  version: number;
  method: "safeStorage" | "aes-gcm";
  data: string;
  iv?: string;
  authTag?: string;
}

/**
 * 获取凭据存储文件路径
 */
const getCredentialFilePath = (): string => {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "credentials", "encrypted.json");
};

/**
 * 获取机器绑定密钥（用于 AES-GCM 回退方案）
 */
const getMachineKey = (): Buffer => {
  // 使用 app.getPath("userData") 作为机器标识的一部分
  // 在生产环境中，可以结合更多机器特征（如 MAC 地址、CPU ID 等）
  const userDataPath = app.getPath("userData");
  const machineId = crypto.createHash("sha256").update(userDataPath).digest();
  
  // 派生固定长度的密钥
  return crypto.pbkdf2Sync(machineId, "file-pilot-salt", 100000, KEY_LENGTH, "sha256");
};

/**
 * 使用 safeStorage 加密
 */
const encryptWithSafeStorage = (plaintext: string): string => {
  const buffer = safeStorage.encryptString(plaintext);
  return buffer.toString("base64");
};

/**
 * 使用 safeStorage 解密
 */
const decryptWithSafeStorage = (encrypted: string): string => {
  const buffer = Buffer.from(encrypted, "base64");
  return safeStorage.decryptString(buffer);
};

/**
 * 使用 AES-GCM 加密（回退方案）
 */
const encryptWithAesGcm = (plaintext: string): { data: string; iv: string; authTag: string } => {
  const key = getMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  return {
    data: encrypted,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
};

/**
 * 使用 AES-GCM 解密（回退方案）
 */
const decryptWithAesGcm = (encrypted: string, ivBase64: string, authTagBase64: string): string => {
  const key = getMachineKey();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
};

/**
 * 保存加密凭据到文件
 */
const saveToFile = (credential: EncryptedCredential): void => {
  const filePath = getCredentialFilePath();
  const dir = path.dirname(filePath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(credential, null, 2), "utf8");
};

/**
 * 从文件读取加密凭据
 */
const loadFromFile = (): EncryptedCredential | null => {
  const filePath = getCredentialFilePath();
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as EncryptedCredential;
  } catch {
    return null;
  }
};

/**
 * 存储凭据（自动选择最佳加密方式）
 */
export const storeCredential = (key: string, value: string): void => {
  const payload = JSON.stringify({ [key]: value });
  
  // 优先使用 safeStorage
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = encryptWithSafeStorage(payload);
    saveToFile({
      version: CREDENTIAL_VERSION,
      method: "safeStorage",
      data: encrypted
    });
  } else {
    // 回退到 AES-GCM
    const { data, iv, authTag } = encryptWithAesGcm(payload);
    saveToFile({
      version: CREDENTIAL_VERSION,
      method: "aes-gcm",
      data,
      iv,
      authTag
    });
  }
};

/**
 * 读取凭据
 */
export const retrieveCredential = (key: string): string | null => {
  const credential = loadFromFile();
  
  if (credential === null) {
    return null;
  }
  
  try {
    let payload: string;
    
    if (credential.method === "safeStorage") {
      payload = decryptWithSafeStorage(credential.data);
    } else if (credential.method === "aes-gcm") {
      if (credential.iv === undefined || credential.authTag === undefined) {
        return null;
      }
      payload = decryptWithAesGcm(credential.data, credential.iv, credential.authTag);
    } else {
      return null;
    }
    
    const parsed = JSON.parse(payload) as Record<string, string>;
    return parsed[key] ?? null;
  } catch {
    return null;
  }
};

/**
 * 删除凭据
 */
export const deleteCredential = (): void => {
  const filePath = getCredentialFilePath();
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

/**
 * 检查加密是否可用
 */
export const isEncryptionAvailable = (): boolean => {
  return safeStorage.isEncryptionAvailable();
};

/**
 * 获取当前加密方法
 */
export const getCurrentEncryptionMethod = (): "safeStorage" | "aes-gcm" | "none" => {
  const credential = loadFromFile();
  
  if (credential === null) {
    return "none";
  }
  
  return credential.method;
};
