# E2E 测试目录说明

本目录用于存放 Electron E2E 用例（Playwright Electron 模式）。

首批建议落地：

1. `startup.spec.ts`：首屏渲染、preload API 注入、白屏检测
2. `workflow.spec.ts`：白名单 -> 拖拽 -> 分析 -> dry-run -> 回滚
3. `error-path.spec.ts`：白名单拒绝路径、客户端错误上报
4. `package-smoke.spec.ts`：打包后安装包产物可读冒烟

当前测试矩阵见：`docs/architecture/e2e-test-plan.md`。

执行方式：

1. `npm run build`
2. `npm run test:e2e`
