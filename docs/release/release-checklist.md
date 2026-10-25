# M2 Release Checklist

> 状态说明（2026-10-25 修订）：原文件名为 m1-checklist 而内容为 M2/M3 清单，且全部勾选但缺少证据链接。
> 现按实际验证状态重新标注：功能实现项以代码为准；**尚未执行或无证据的项一律未勾选**。
> M3 完整范围（去重/搜索/命名规范/回迁提醒）尚未实现，本清单只覆盖 M2 + 规则学习子集。

## Functional Scope

- [x] Prompt templating moved to file-based template (`classify.v1.njk`)
- [x] Classification pipeline order fixed to `rule -> LLM primary -> LLM secondary -> local fallback`
- [x] Low-confidence follow-up flow implemented
- [x] User correction persistence and rule learning implemented
- [x] Rule management APIs implemented (list/enable-disable/priority update)
- [x] `apply` honors request `action` (`move`/`copy`) with dry-run default policy preserved
- [x] SQLite repositories enabled for sessions/items/rules/decisions/log index
- [x] Incremental SQL migrations enabled (`schema_migrations`, `0001..0003`)
- [x] One-time legacy JSON import to SQLite on bootstrap

## Contract and Type Compatibility

- [x] IPC channels added and validated by Zod:
  - `fp:submit-followup`
  - `fp:save-corrections`
  - `fp:list-rules`
  - `fp:update-rule`
- [x] Unified IPC response shape preserved (`{ ok: true, data } | { ok: false, error }`)
- [x] Workflow types extended (`ConfidenceBand`, follow-up metadata, decision source)
- [x] Settings compatibility fallback for new rule-learning fields

## Test Gates

- [x] `npm run typecheck`（2026-10-25 于 fix/full-review-20261025 分支验证）
- [x] `npm run lint`（同上）
- [x] `npm run test` (unit + integration)（同上，84/84）
- [x] `npm run build`（同上）
- [ ] `npm run test:e2e`（本分支未执行；需在 Electron 原生重建后运行）
- [ ] `npm run test:qa`（本分支未执行）
- [ ] `npm run dist:win`（本分支未执行）

## CI Gates

- [x] PR/main: `typecheck`, `lint`, `unit+integration`, `build`, `e2e`, `package smoke`（ci-gates.yml 已配置）
- [x] nightly: `qa-nightly` with artifact upload（已配置，尚未有首次运行记录）
- [x] pre-release: `qa-pre-release` with artifact upload（已配置，见 qa-acceptance.md 关于其触发时机为发布后的说明）
- [x] docs sync gate retained

## QA Acceptance Targets

- [ ] Performance: 100-file dry-run `< 8s`, execute `< 20s`（待 `test:qa:perf` 首次运行产出证据）
- [ ] Reliability: rollback success rate `> 99%`（待 `test:qa:reliability` 首次运行产出证据）
- [ ] QA JSON reports produced under `test-results/qa/`
