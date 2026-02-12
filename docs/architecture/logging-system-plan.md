# 日志系统建设规划

## 目标

- 建立主进程与业务流程统一日志系统，覆盖会话日志、执行日志、错误日志。
- 保证日志可导出、可匿名化、可追溯（traceId/sessionId）。
- 为白屏、IPC异常、执行回滚问题提供可定位证据。

## 范围

1. 统一日志模型
   - 字段：`id, timestamp, level, category, code, message, traceId, sessionId, details`
2. 采集链路
   - IPC handler：请求开始/完成/失败
   - 执行链路：apply/rollback
   - 全局异常：`uncaughtException`, `unhandledRejection`
3. 存储与导出
   - 本地 JSONL 追加写入
   - 导出接口按分类聚合后走已有匿名化导出
4. 运行策略
   - 日志体积阈值告警（先实现阈值判断）
   - 后续补齐轮转和归档策略

## 分阶段实施

### Phase A（已实施）

- `infra/logging/file-logger.ts`：写入、筛选读取、体积阈值判断
- `electron/main/handler-registry.ts`：会话/执行/错误日志接入
- `electron/main/real-main.ts`：主进程未捕获异常日志接入
- `exportLogs` 从真实日志源聚合导出

### Phase B（待实施）

- 渲染进程错误边界与白屏日志采集（已实现基础版：renderer error/unhandledrejection 上报）
- 日志轮转、压缩归档、清理入口（已实现轮转基础与清理入口，压缩归档待实现）
- 崩溃报告结构化采集与导出

### Phase C（待实施）

- 日志查询索引（sessionId/traceId）
- 设置页日志开关与保留策略可视化

## 验收标准

- 能在日志中追踪一次完整流程：分析 -> dry-run -> 回滚 -> 导出
- 出错时日志包含 `code + traceId + message`
- 导出日志不为空，且匿名化开关生效
