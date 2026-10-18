# 交付记录：2026-10-18（tray-popover UI）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `feat/tray-popover-ui-20261018` |
| 日期 | `2026-10-18` |
| 基线 | `6045350`（`fix/review-findings-20261018`） |
| 形态 | 系统托盘 + 无边框悬浮窗 + 独立设置窗口 |

## 变更清单

- **托盘常驻**：新增 `window-manager.ts`；托盘左键切换悬浮窗，右键菜单提供打开/设置/打开工作区/退出；单实例锁、二次启动唤起、`window-all-closed` 不退出。
- **悬浮窗**：396px 宽无边框透明窗口，靠近托盘定位；点击外部/`Esc` 收起；按内容自适应高度（`fp:resize-popover`）；拖拽 + 文件选择器两种导入方式。
- **主流程重排**：dropzone、文件 chip、分析/预演、计划卡（前 4 项 + 置信度 + 坐标）、二次确认执行、回滚、追问/修正、打开工作区/新建会话。
- **独立设置窗口**：`?view=settings` 分支 + `SettingsApp`；侧边栏导航（通用/分类/规则/登记册/LLM/更新/日志/高级），关闭后回到悬浮窗并刷新设置。
- **设置功能补齐**：新增规则管理面板与更新面板；白名单编辑改走 `saveWhitelist` 并修复此前“高级页白名单不持久化”的问题；更新面板保留 SHA-512 校验下载流程。
- **视觉系统**：深色 obsidian + 薄荷强调、Segoe UI Variable/微软雅黑排版、玻璃卡片、细噪点、进入/展开动画、减少动态偏好支持；新增托盘/安装器图标（`resources/icon.ico`、`tray-icon.png`）。
- **IPC/preload**：新增 `openSettings` / `hidePopover` / `closeSettings` / `openWorkspace` / `pickFiles` / `resizePopover` 与 `onPopoverShown` 事件；Zod 校验空载荷/窗口高度。
- **E2E 适配**：helper 新增 `openSettingsWindow` / `closeSettingsWindow`；UI 规格改为双窗口；继续默认隐藏窗口（不闪桌面）。

## 更新文档变更

- 新增 `docs/architecture/tray-ui.md`（窗口模型、主进程、渲染分支、测试模式、图标）。
- `README.md`：改为托盘优先的说明、使用流程、IPC 通道、隐藏窗口测试说明。
- `apps/desktop/tests/e2e/README.md`：新增设置窗口 helper 与托盘/悬浮窗说明。
- `docs/release/README.md`：交付记录索引加入本文件。
- 新增本交付记录。

## 回滚说明

- 代码回滚：`git revert <tray-ui-commit>`；未合并前可直接 `git reset --hard 6045350`。
- 数据库：无新增迁移；设置结构未变，回滚后单窗口版本可读取同一份 settings/SQLite。
- 图标：回滚代码后 `resources/` 与 `electron/assets/` 可保留，不影响旧版；如回滚打包配置，electron-builder 会回到默认图标。
- 用户数据：`%APPDATA%\File Pilot` 不受影响；托盘/窗口形态变化不迁移数据。
- 更新缓存：如已下载新版本安装包，回滚前建议清理 `updates/` 目录。

## 验证证据

执行环境：Windows 11（win32 10.0.26100 x64）、Node `v24.13.0`、npm `11.6.2`。worktree：`.worktrees/tray-ui`；基线 `6045350`。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过（exit 0） | 重构后复验 |
| `npm run lint` | 通过（exit 0） | 0 错误 0 警告 |
| `npm run test` | 通过（exit 0） | 35 文件 / 257 用例 |
| `npm run build` | 通过（exit 0） | renderer + electron + 图标/迁移/模板复制 |
| 隐藏 UI e2e | 12/12 通过 | startup、ui-onboarding（4）、ui-settings（6）、registry-wizard（1）；窗口隐藏，无桌面闪烁 |
| 完整 e2e（第一次） | 25 passed / 2 skipped / 1 failed | 唯一失败为 `settings-back` 关闭窗口的点击竞态；helper 已加 catch，单条复跑通过 |
| 完整 e2e（复跑） | 待复跑 | 修复 helper 后尚未重新跑全量，见 `docs/plan/tray-ui-followups.md` |
| 托盘冒烟 | 通过 | 生产模式启动（tray enabled、已配置白名单），`app.isReady()=true`，悬浮窗 `visible=false`，无崩溃 |
| 视觉检查 | 通过 | 截取 onboarding / 就绪悬浮窗 / 设置通用 / 设置登记册，确认自适应高度、排版、层级 |
| `npx playwright test --list` | 通过 | 28 tests / 12 files |

未在本次执行：完整 Playwright e2e 的最终复跑、`npm run dist:win` 与打包后 smoke（图标/托盘资产未在本机打包验证）。

## 已知事项

- 托盘图标与原生菜单在 CI/隐藏模式下不创建；托盘路径仅做了本机生产模式冒烟。
- 设置窗口关闭时若有 600ms 防抖保存未完成，控制器会随窗口销毁；当前自动保存状态可见，极端情况下需重开设置重新保存。
- 悬浮窗定位依赖托盘 bounds；多显示器/任务栏在顶部的场景已做 fallback，但未做全排列截图验证。
- 托盘右键菜单文案目前是主进程内的英文硬编码（Open / Settings / Quit），尚未接入 i18n。
- `pages/app.tsx` 约 494 行；主流程已抽到 `pages/popover/*`，但状态/处理器仍集中在一个文件，后续可继续抽 `usePopoverWorkflow`。
- `pages/components/rule-management-panel.tsx` 已被设置页的 `RulesPanel` 取代，当前未删除（死代码）。
