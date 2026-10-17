/**
 * LLM Provider 类型定义
 * 
 * 设计原则：
 * 1. 统一接口：所有供应商通过统一的 Provider 接口访问
 * 2. 可扩展：支持内置预设 + 自定义端点
 * 3. 向后兼容：保持与现有 AppSettings.llm 结构兼容
 */

/**
 * Provider 认证类型
 */
export type ProviderAuthType = 
  | "bearer"      // Authorization: Bearer {apiKey}
  | "api-key"     // X-API-Key: {apiKey} 或其他自定义 header
  | "none";       // 无需认证（本地模型）

/**
 * Provider 协议类型
 */
export type ProviderProtocol =
  | "openai"          // 完全兼容 OpenAI API
  | "local-decision"  // 本地决策端点（Laya/System One 形态：结构化状态 + 类型化问题，决策模型影子模式 T1）
  | "custom";         // 需要自定义适配

export type ProviderModelControlMode = "intensity" | "manual";

export type ProviderIntensityLevel = "speed" | "balanced" | "quality";

export interface ProviderModelPair {
  primaryModel: string;
  secondaryModel: string;
}

export interface ProviderIntensityProfiles {
  speed: ProviderModelPair;
  balanced: ProviderModelPair;
  quality: ProviderModelPair;
}

/**
 * Provider 预设 ID（内置供应商）
 */
export type ProviderPresetId =
  | "openai"
  | "volcano-engine"  // 火山引擎/豆包
  | "deepseek"
  | "moonshot"        // Moonshot/Kimi
  | "zhipu"           // 智谱/GLM
  | "alibaba-tongyi"  // 阿里通义 Qwen
  | "baidu-wenxin"    // 百度文心
  | "siliconflow"
  | "custom";         // 自定义端点

/**
 * Provider 配置（存储在 settings 中）
 */
export interface LlmProviderConfig {
  /** Provider ID（预设 ID 或自定义 UUID） */
  id: string;

  /** 预设模板 ID（仅 isPreset=true 时存在） */
  presetId?: ProviderPresetId;
  
  /** 显示名称 */
  name: string;
  
  /** 是否为内置预设 */
  isPreset: boolean;
  
  /** API Base URL */
  baseUrl: string;
  
  /** 认证类型 */
  authType: ProviderAuthType;
  
  /** API Key（敏感信息，需加密存储） */
  apiKey?: string;
  
  /** 协议类型 */
  protocol: ProviderProtocol;
  
  /** 主模型名称 */
  primaryModel: string;
  
  /** 备用模型名称 */
  secondaryModel: string;

  /** 模型选择模式：强度档位 or 手动填写 */
  modelControlMode: ProviderModelControlMode;

  /** 当前强度档位 */
  intensity: ProviderIntensityLevel;

  /** 各强度档位对应的主备模型 */
  intensityProfiles: ProviderIntensityProfiles;
  
  /** 是否启用（用于多 provider 场景） */
  enabled: boolean;
  
  /** 自定义请求头（可选，用于特殊供应商） */
  customHeaders?: Record<string, string>;
  
  /** 端点路径（可选，默认 /chat/completions） */
  endpoint?: string;

  /**
   * 本地决策请求形态（仅 protocol="local-decision" 时生效，缺省 "systemone"）：
   * - "systemone"：结构化 questions 端点（默认路径 /v1/systemone）；
   * - "openai-chat"：借 OpenAI 兼容对话端点承载决策负载（默认路径 /chat/completions）。
   */
  decisionMode?: "systemone" | "openai-chat";

  /** 本地决策端点路径覆盖（仅 protocol="local-decision" 时生效；缺省按 decisionMode 取默认路径）。 */
  decisionEndpointPath?: string;
}

/**
 * Provider 预设模板（用于快速配置）
 */
export interface LlmProviderPreset {
  id: ProviderPresetId;
  name: string;
  baseUrl: string;
  authType: ProviderAuthType;
  protocol: ProviderProtocol;
  defaultPrimaryModel: string;
  defaultSecondaryModel: string;
  intensityProfiles?: ProviderIntensityProfiles;
  suggestedModels?: string[];
  endpoint?: string;
  customHeaders?: Record<string, string>;
  description: string;
  requiresApiKey: boolean;
}
