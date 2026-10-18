# E2E Tests

本目录包含 File-Pilot 的 Playwright Electron E2E 场景。Playwright 通过 `electron.launch` 直接启动 Electron 二进制（不依赖浏览器），启动前需 `npm run build` 产出 `dist/electron/main.cjs`。

## Current specs

1. `startup.spec.ts`：启动与 preload API 注入。
2. `workflow.spec.ts`：白名单 -> analyze -> follow-up -> correction -> dry-run 主流程。
3. `rollback.spec.ts`：真实 move/copy 执行后回滚，源文件恢复原位。（新增）
4. `isolation.spec.ts`：验证 `FILE_PILOT_USER_DATA_DIR` / `FILE_PILOT_WORKSPACE_ROOT` 隔离，测试不触碰真实用户数据。（新增）
5. `llm-success.spec.ts`：由确定性 LLM stub 驱动的分类成功链路。（新增）
6. `ui-onboarding.spec.ts`：首启向导、只读跳过、拖拽导入等主页面真实 UI 交互。（新增）
7. `ui-settings.spec.ts`：设置页真实 UI 交互（自动保存状态、只读开关、语言切换、LLM 供应商管理）。（新增）
8. `error-path.spec.ts`：白名单拒绝与 LLM 兜底行为。
9. `rule-learning.spec.ts`：手工修正沉淀为规则并在下次分析中复用。
10. `migration.spec.ts`：带迁移路径的启动与正常工作流。
11. `registry-wizard.spec.ts`：登记册容器目录、自动编号、exact 阻断、similar 警告与建域向导 UI。
12. `package-smoke.spec.ts`：打包产物冒烟检查（隔离启动 `cwd` 与打包后 `analyze` 路径）。

## Execute

1. `npm run build`
2. `npm run test:e2e:core`（核心门禁：startup / workflow / rollback 三件套，本地快速验证）
3. `npm run test:e2e`（全量 e2e）

For packaged smoke:

1. `npm run dist:win`
2. `FILE_PILOT_RUN_PACKAGED_SMOKE=1 npx playwright test apps/desktop/tests/e2e/package-smoke.spec.ts`

失败诊断由 `playwright.config.ts` 统一提供：`trace: "on-first-retry"`、`screenshot: "only-on-failure"`、HTML 报告输出到 `playwright-report/`（`open: "never"`），CI 中 `retries: 1`。

## Tray-first windows

The app is tray-resident: the first BrowserWindow is the compact popover (`?view=popover`), created hidden and shown by the tray. Clicking the gear opens a separate settings BrowserWindow (`?view=settings`) via `fp:open-settings`. Tests must use the helpers:

- `openSettingsWindow(app, popoverPage)` waits for the new window and returns its page.
- `closeSettingsWindow(settingsPage)` clicks `settings-back` and waits for close; the popover page remains available.

Specs that only use `window.filePilotApi` keep using `app.firstWindow()`; they do not need to open settings.

## Hidden window mode

`helpers/electron-launch.ts` 默认通过 `FILE_PILOT_E2E_HIDE_WINDOW=1` 让主进程以 `show: false` 创建窗口，Playwright 仍通过 CDP 驱动页面。因此运行 e2e 时不会在桌面上反复弹出/闪烁窗口。需要肉眼看 UI 调试时，调用 `launchElectronApp({ hideWindow: false })`。

## 测试隔离

E2E 测试永不触碰真实用户数据：

- `helpers/electron-launch.ts` 在启动 Electron 时自动注入 `FILE_PILOT_USER_DATA_DIR` / `FILE_PILOT_WORKSPACE_ROOT` 两个环境变量，指向按用例创建的临时目录（`mkdtemp`），用例结束后清理；同时默认注入 `FILE_PILOT_E2E_HIDE_WINDOW=1`，窗口保持隐藏。
- 应用主进程读取这两个环境变量作为 userData 与工作区根目录，因此 SQLite 数据、settings、logs 均落在临时目录中。
- 任何测试都不会读写 `%APPDATA%\File Pilot` 下的真实目录，也不会操作真实用户文件；如需扩展启动行为，只改 `helpers/electron-launch.ts`，不要在 spec 内直接拼环境变量。

## LLM stub

E2E 不发起真实 LLM 网络请求：

- `helpers/llm-stub.ts` 提供确定性 LLM stub：对 classify 请求返回预置的 purpose/project/confidence 结果，保证成功链路（如由 stub 驱动的 `llm-success.spec.ts`）可离线、可复现。
- 需要验证兜底/错误路径时，可让 stub 返回无效输出，走 rule-first 本地兜底链路（见 `error-path.spec.ts`）。
- stub 通过 electron-launch helper 注入到被测应用；确切用法以 `helpers/llm-stub.ts` 内导出与注释为准。

## MCP frontend check (manual)

You can also run a manual frontend smoke using Chrome DevTools MCP:

1. Start renderer preview: `npm run dev -- --host 127.0.0.1 --port 4173`
2. Open `http://127.0.0.1:4173` with MCP.
3. Verify no console errors and core UI elements exist:
   - title `File-Pilot`
   - whitelist input and action buttons
   - follow-up / correction controls after a successful analyze in Electron context

Use MCP for quick interaction debugging, but keep Playwright as the CI gate.
