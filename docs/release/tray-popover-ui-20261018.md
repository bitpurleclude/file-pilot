# 交付记录：2026-10-18（tray-popover UI）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `feat/tray-popover-ui-20261018` |
| 日期 | `2026-10-18` |
| 基线 | `6045350`（`fix/review-findings-20261018`） |
| 后续提交 | `12ce9c2`（P0/P1：关闭前保存、打包图标、全量验证） |
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
- **关闭前保存**：设置窗口关闭改为主进程→渲染进程握手，先 flush 600ms 防抖保存再确认关闭，1.5s 无响应兜底强制关闭。
- **打包图标**：`afterPack + rcedit` 注入 exe 图标与 Windows 版本元数据，绕开 electron-builder 自带 rcedit 的 winCodeSign 解压权限问题；NSIS 显式指定 installer/uninstaller 图标。

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
| `npm run test` | 通过（exit 0） | 35 文件 / 260 用例 |
| `npm run build` | 通过（exit 0） | renderer + electron + 图标/迁移/模板复制 |
| `npx playwright test`（全量） | **27 passed / 2 skipped** | 窗口隐藏，无桌面闪烁；2 个 package-smoke 在未打包时自跳过 |
| `npm run dist:win` | 通过（exit 0） | NSIS + Portable + `latest.yml`；afterPack 注入图标与版本元数据 |
| packaged smoke | 2/2 通过 | `FILE_PILOT_RUN_PACKAGED_SMOKE=1`，真实启动 win-unpacked |
| packaged tray smoke | 通过 | 打包产物 + 已配置白名单：`isReady=true`、悬浮窗 `visible=false` |
| 图标验证 | 通过 | exe / installer / portable 三者提取图标均为新薄荷文件夹图标；`ProductName=File Pilot`、版本 `0.1.0` |
| 视觉检查 | 通过 | onboarding / 就绪悬浮窗 / 设置通用 / 设置登记册，确认自适应高度、排版、层级 |
| `npx playwright test --list` | 通过 | 29 tests / 12 files |

完整 e2e、打包与 packaged smoke 均已在本机完成。打包图标通过 `afterPack + rcedit` 注入，绕开 electron-builder 自带 rcedit 对 winCodeSign 解压的符号链接权限要求。

## 已知事项

- 托盘图标与原生菜单在 CI/隐藏模式下不创建；托盘路径已做本机生产模式与打包产物冒烟。
- 悬浮窗定位依赖托盘 bounds；多显示器/任务栏在顶部的场景已做 fallback，但未做全排列截图验证。
- 托盘右键菜单文案目前是主进程内的英文硬编码（Open / Settings / Quit），尚未接入 i18n。
- `pages/app.tsx` 约 494 行；主流程已抽到 `pages/popover/*`，但状态/处理器仍集中在一个文件，后续可继续抽 `usePopoverWorkflow`。
- 设置窗口关闭时已通过 `fp:settings-close-requested` / `fp:confirm-settings-close` 握手 flush 600ms 防抖保存，并保留 1.5s 兜底关闭；死代码 `rule-management-panel.tsx` 已删除。
