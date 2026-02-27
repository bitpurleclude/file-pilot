import type {
  LlmProviderConfig,
  LlmProviderPreset,
  ProviderIntensityLevel,
  ProviderIntensityProfiles,
  ProviderModelControlMode
} from "../types/llm-provider.js";

/**
 * 内置 LLM 供应商预设配置
 * 
 * 数据来源：各供应商官方 API 文档
 * 更新时间：2026-02-26
 */
const createProfiles = (params: {
  speed: { primaryModel: string; secondaryModel: string };
  balanced: { primaryModel: string; secondaryModel: string };
  quality: { primaryModel: string; secondaryModel: string };
}): ProviderIntensityProfiles => ({
  speed: params.speed,
  balanced: params.balanced,
  quality: params.quality
});

export const createDefaultIntensityProfiles = (
  primaryModel: string,
  secondaryModel: string
): ProviderIntensityProfiles => {
  const speedModel = secondaryModel.length > 0 ? secondaryModel : primaryModel;
  return createProfiles({
    speed: {
      primaryModel: speedModel,
      secondaryModel: speedModel
    },
    balanced: {
      primaryModel,
      secondaryModel
    },
    quality: {
      primaryModel,
      secondaryModel
    }
  });
};

export const LLM_PROVIDER_PRESETS: Record<string, LlmProviderPreset> = {
  "openai": {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "gpt-4o",
    defaultSecondaryModel: "gpt-4o-mini",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "gpt-4o-mini", secondaryModel: "gpt-4o-mini" },
      balanced: { primaryModel: "gpt-4o", secondaryModel: "gpt-4o-mini" },
      quality: { primaryModel: "gpt-4.1", secondaryModel: "gpt-4o" }
    }),
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
    description: "OpenAI official API (GPT-4, GPT-3.5)",
    requiresApiKey: true
  },
  
  "volcano-engine": {
    id: "volcano-engine",
    name: "火山引擎/豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "ep-20250101-xxxxx",
    defaultSecondaryModel: "ep-20250101-xxxxx",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "ep-20250101-xxxxx", secondaryModel: "ep-20250101-xxxxx" },
      balanced: { primaryModel: "ep-20250101-xxxxx", secondaryModel: "ep-20250101-xxxxx" },
      quality: { primaryModel: "ep-20250101-xxxxx", secondaryModel: "ep-20250101-xxxxx" }
    }),
    suggestedModels: ["ep-20250101-xxxxx"],
    description: "字节跳动火山引擎大模型服务（需配置 endpoint ID）",
    requiresApiKey: true
  },
  
  "deepseek": {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "deepseek-chat",
    defaultSecondaryModel: "deepseek-coder",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "deepseek-chat", secondaryModel: "deepseek-chat" },
      balanced: { primaryModel: "deepseek-chat", secondaryModel: "deepseek-coder" },
      quality: { primaryModel: "deepseek-chat", secondaryModel: "deepseek-coder" }
    }),
    suggestedModels: ["deepseek-chat", "deepseek-coder"],
    description: "DeepSeek API (OpenAI compatible)",
    requiresApiKey: true
  },
  
  "moonshot": {
    id: "moonshot",
    name: "Moonshot AI (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "moonshot-v1-8k",
    defaultSecondaryModel: "moonshot-v1-32k",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "moonshot-v1-8k", secondaryModel: "moonshot-v1-8k" },
      balanced: { primaryModel: "moonshot-v1-8k", secondaryModel: "moonshot-v1-32k" },
      quality: { primaryModel: "moonshot-v1-32k", secondaryModel: "moonshot-v1-128k" }
    }),
    suggestedModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    description: "月之暗面 Kimi 大模型（OpenAI 兼容）",
    requiresApiKey: true
  },
  
  "zhipu": {
    id: "zhipu",
    name: "智谱 AI (GLM)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "glm-4",
    defaultSecondaryModel: "glm-3-turbo",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "glm-3-turbo", secondaryModel: "glm-3-turbo" },
      balanced: { primaryModel: "glm-4", secondaryModel: "glm-3-turbo" },
      quality: { primaryModel: "glm-4-plus", secondaryModel: "glm-4" }
    }),
    suggestedModels: ["glm-3-turbo", "glm-4", "glm-4-plus"],
    description: "智谱 AI GLM 系列模型（OpenAI 兼容）",
    requiresApiKey: true
  },
  
  "alibaba-tongyi": {
    id: "alibaba-tongyi",
    name: "阿里通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "qwen-turbo",
    defaultSecondaryModel: "qwen-plus",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "qwen-turbo", secondaryModel: "qwen-turbo" },
      balanced: { primaryModel: "qwen-plus", secondaryModel: "qwen-turbo" },
      quality: { primaryModel: "qwen-max", secondaryModel: "qwen-plus" }
    }),
    suggestedModels: ["qwen-turbo", "qwen-plus", "qwen-max"],
    description: "阿里云通义千问大模型（OpenAI 兼容模式）",
    requiresApiKey: true
  },
  
  "baidu-wenxin": {
    id: "baidu-wenxin",
    name: "百度文心一言",
    baseUrl: "https://qianfan.baidubce.com/v2",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "ernie-4.0-8k",
    defaultSecondaryModel: "ernie-3.5-8k",
    intensityProfiles: createProfiles({
      speed: { primaryModel: "ernie-3.5-8k", secondaryModel: "ernie-3.5-8k" },
      balanced: { primaryModel: "ernie-4.0-8k", secondaryModel: "ernie-3.5-8k" },
      quality: { primaryModel: "ernie-4.0-8k", secondaryModel: "ernie-4.0-8k" }
    }),
    suggestedModels: ["ernie-3.5-8k", "ernie-4.0-8k"],
    description: "百度文心一言大模型（OpenAI 兼容）",
    requiresApiKey: true
  },
  
  "siliconflow": {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "deepseek-ai/DeepSeek-V3",
    defaultSecondaryModel: "Qwen/Qwen2.5-7B-Instruct",
    intensityProfiles: createProfiles({
      speed: {
        primaryModel: "Qwen/Qwen2.5-7B-Instruct",
        secondaryModel: "Qwen/Qwen2.5-7B-Instruct"
      },
      balanced: {
        primaryModel: "deepseek-ai/DeepSeek-V3",
        secondaryModel: "Qwen/Qwen2.5-7B-Instruct"
      },
      quality: {
        primaryModel: "deepseek-ai/DeepSeek-V3",
        secondaryModel: "Qwen/Qwen2.5-32B-Instruct"
      }
    }),
    suggestedModels: [
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/Qwen2.5-32B-Instruct",
      "deepseek-ai/DeepSeek-V3"
    ],
    description: "SiliconFlow 推理加速平台（OpenAI 兼容）",
    requiresApiKey: true
  }
} as const;

/**
 * 获取所有预设供应商列表
 */
export const getAllProviderPresets = (): LlmProviderPreset[] => {
  return Object.values(LLM_PROVIDER_PRESETS);
};

/**
 * 根据 ID 获取预设配置
 */
export const getProviderPreset = (id: string): LlmProviderPreset | undefined => {
  const preset = LLM_PROVIDER_PRESETS[id];
  return preset === undefined ? undefined : preset;
};

/**
 * 检查是否为内置预设 ID
 */
export const isPresetProvider = (id: string): boolean => {
  return id in LLM_PROVIDER_PRESETS;
};

export const getProviderSuggestedModels = (provider: LlmProviderConfig): string[] => {
  if (!provider.isPreset) {
    return [];
  }
  const preset = getProviderPreset(provider.presetId ?? provider.id);
  return preset?.suggestedModels ?? [];
};

export const normalizeProviderConfig = (provider: LlmProviderConfig): LlmProviderConfig => {
  const intensityProfiles = provider.intensityProfiles ?? createDefaultIntensityProfiles(
    provider.primaryModel,
    provider.secondaryModel
  );
  const modelControlMode: ProviderModelControlMode = provider.modelControlMode ?? "manual";
  const intensity: ProviderIntensityLevel = provider.intensity ?? "balanced";

  return {
    ...provider,
    modelControlMode,
    intensity,
    intensityProfiles
  };
};

export const resolveProviderModels = (
  provider: LlmProviderConfig
): { primaryModel: string; secondaryModel: string } => {
  if (provider.modelControlMode === "intensity") {
    const profile = provider.intensityProfiles[provider.intensity];
    return {
      primaryModel: profile.primaryModel,
      secondaryModel: profile.secondaryModel
    };
  }

  return {
    primaryModel: provider.primaryModel,
    secondaryModel: provider.secondaryModel
  };
};

export const buildProviderFromPreset = (params: {
  providerId: string;
  presetId: string;
  apiKey?: string;
}): LlmProviderConfig => {
  const fallbackPreset = LLM_PROVIDER_PRESETS.openai;
  if (fallbackPreset === undefined) {
    throw new Error("openai preset not found");
  }
  const preset = getProviderPreset(params.presetId) ?? fallbackPreset;
  const intensityProfiles = preset.intensityProfiles ?? createDefaultIntensityProfiles(
    preset.defaultPrimaryModel,
    preset.defaultSecondaryModel
  );

  return {
    id: params.providerId,
    presetId: preset.id,
    name: preset.name,
    isPreset: true,
    baseUrl: preset.baseUrl,
    authType: preset.authType,
    protocol: preset.protocol,
    ...(params.apiKey === undefined ? {} : { apiKey: params.apiKey }),
    primaryModel: preset.defaultPrimaryModel,
    secondaryModel: preset.defaultSecondaryModel,
    modelControlMode: "intensity",
    intensity: "balanced",
    intensityProfiles,
    enabled: true,
    ...(preset.endpoint === undefined ? {} : { endpoint: preset.endpoint }),
    ...(preset.customHeaders === undefined ? {} : { customHeaders: preset.customHeaders })
  };
};
