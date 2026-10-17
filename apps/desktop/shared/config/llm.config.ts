export const LLM_CONFIG = {
  timeoutMs: 20_000,
  retryCount: 2,
  retryBaseDelayMs: 300,
  retryJitterMs: 500,
  temperature: 0,
  maxTokensSingle: 800,
  maxTokensBatch: 2000,
  batchSize: 10,
  llmConcurrency: 2,
  modelTier: "high-quality",
  fallbackOrder: ["primary", "secondary", "local-rule"],
  /**
   * 坐标认领约定（governance-design.md §4.3）：提供坐标清单时，模型提议新建项目
   * 必须输出 "<前缀><简短名称>"（触发建域向导而非直接落盘）。提示词模板与输出
   * 校验（infra/llm/coordinate-output.ts）共同使用本常量，保持单一来源。
   */
  newProjectPrefix: "NEW:",
  /**
   * 本地决策模型影子模式（decision-models.md §5 T1）：主链路照常，旁路用可插拔
   * 本地决策客户端对同一输入做两级分解（先领域 ≤8 选项、后项目 ≤9 选项），只
   * 记录对齐、绝不影响 plan。默认关闭且端点为空——此时全链路零开销（静默跳过）。
   */
  shadow: {
    enabled: false,
    endpointBaseUrl: "",
    mode: "systemone",
    timeoutMs: 3000
  }
} as const;
