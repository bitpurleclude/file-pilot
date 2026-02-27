# LLM Provider-Only Settings（v1）

## 背景

为消除旧版 `settings.llm` 与 `settings.llmProviders` 的重复配置，设置与运行链路统一改为 Provider-only 模型。

## 配置模型

- `AppSettings` 移除 `llm` 字段。
- 新结构仅保留 `llmProviders`：
  - `activeProviderId`
  - `providers`（至少 1 项）
- `LlmProviderConfig` 增加模型策略字段：
  - `modelControlMode`: `"intensity" | "manual"`
  - `intensity`: `"speed" | "balanced" | "quality"`
  - `intensityProfiles`: 三档主备模型映射

## 运行链路

- `infra/llm/llm-gateway.ts` 成为唯一网关实现。
- 调用流程：激活 Provider -> 主模型 -> 备用模型 -> 本地规则兜底。
- 旧 `llm-gateway-v2.ts` 已移除。

## 兼容迁移

`settings-repository.loadSettings` 新增无感迁移：

1. 发现 legacy `llm` 且无 `llmProviders` 时，自动迁移为单 Provider。
2. 发现旧 Provider 缺失 `modelControlMode/intensity/intensityProfiles` 时自动补齐默认值。
3. 迁移完成后自动回写 `settings.json`。

## 设置页交互

- 设置页保留 Tab 结构，移除独立 `Providers` Tab。
- `LLM` Tab 内合并：供应商管理、连接参数、模型策略、连接测试。
- 全页改为自动保存：文本输入 600ms 防抖；开关/下拉/按钮立即保存。
- 顶部显示自动保存状态：`saving/saved/error`，失败时支持重试。

## IPC 约束

- `saveSettings` 合约仅允许 `llmProviders`。
- payload 使用 `strict` 模式，拒绝 legacy `llm` 字段。
- `activeProviderId` 必须命中 providers 列表中的某一项。
