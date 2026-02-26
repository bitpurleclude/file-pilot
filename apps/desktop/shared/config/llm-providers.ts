import type { LlmProviderPreset } from "../types/llm-provider.js";

/**
 * 内置 LLM 供应商预设配置
 * 
 * 数据来源：各供应商官方 API 文档
 * 更新时间：2026-02-26
 */
export const LLM_PROVIDER_PRESETS: Record<string, LlmProviderPreset> = {
  "openai": {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "gpt-4o",
    defaultSecondaryModel: "gpt-4o-mini",
    description: "OpenAI official API (GPT-4, GPT-3.5)",
    requiresApiKey: true
  },
  
  "volcano-engine": {
    id: "volcano-engine",
    name: "火山引擎/豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authType: "bearer",
    protocol: "openai",
    defaultPrimaryModel: "ep-20250101-xxxxx",  // 需要用户填写 endpoint ID
    defaultSecondaryModel: "ep-20250101-xxxxx",
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
  return LLM_PROVIDER_PRESETS[id];
};

/**
 * 检查是否为内置预设 ID
 */
export const isPresetProvider = (id: string): boolean => {
  return id in LLM_PROVIDER_PRESETS;
};
