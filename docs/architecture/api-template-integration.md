# API 模板化接入说明（Nunjucks / Jinja2 风格）

## 目标

- 将 LLM 请求从“代码内拼接 prompt”改为“模板渲染驱动”。
- 保证模板可版本化、可回放、可审计。

## 方案

1. 模板引擎
   - 使用 `nunjucks`，语法风格与 Jinja2 接近，适配 Node/Electron。
2. 模板输入
   - 输入对象统一经过 schema 校验（zod）。
   - 禁止直接将未校验数据注入模板。
3. 模板输出
   - 产出 `systemPrompt` / `userPrompt` 字段后再进入 LLM 网关。
   - 每次调用记录 `prompt_version`。
4. 错误处理
   - 模板渲染失败属于 `SYSTEM_` 级错误，统一走 IPC 错误结构。

## 最小目录建议

```text
apps/desktop/infra/llm/
  templates/
    classify.v1.njk
    explain.v1.njk
  prompt-renderer.ts
  llm-gateway.ts
```

## 后续确认项

- 模板版本命名规则（`v1` / `2026-02-xx` / 语义化版本）
- 模板变更是否要求 ADR
- 模板渲染日志中可记录的字段范围（隐私边界）
