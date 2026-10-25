# Tray UI 交接与待办（2026-10-19）

## 当前状态

- 分支：`feat/tray-popover-ui-20261018`
- worktree：`.worktrees/tray-ui`
- 基线：`6045350`；本次继续后的提交：`12ce9c2`（P0/P1：全量验证、关闭前保存、打包图标）
- 已完成：托盘常驻、无边框自适应悬浮窗、独立设置窗口、深色视觉系统、规则/更新设置页、白名单持久化修复、窗口 IPC、隐藏窗口 e2e、关闭设置前保存、应用/托盘/安装器图标。
- 未合并、未 push；主工作区未改动。

## 已在 2026-10-19 继续完成

| 项目 | 结果 |
| --- | --- |
| 全量隐藏 e2e | **27 passed / 2 skipped**（2 个 package-smoke 在未打包时自跳过） |
| 设置关闭竞态 | helper 修复后全量通过 |
| 关闭前保存 | `fp:settings-close-requested` / `fp:confirm-settings-close` 握手 + 1.5s 兜底；单测 3 条、e2e 1 条通过 |
| `npm run test` | 35 文件 / 260 用例通过 |
| `npm run dist:win` | 通过（NSIS + Portable + latest.yml） |
| packaged smoke | 2/2 通过 |
| 打包图标 | exe / installer / portable 均为新薄荷文件夹图标；版本元数据 0.1.0 |
| 打包托盘冒烟 | 已配置白名单时 `isReady=true`、悬浮窗 `visible=false` |
| 死代码 | 删除 `rule-management-panel.tsx` |

## 下次继续（剩余项）

### P1 — 交互可靠性

1. **托盘人工验证矩阵**
   - 多显示器（副屏任务栏）、任务栏在顶部/左侧、125%/150% 缩放；
   - 首次启动（无白名单）自动弹出 onboarding；已有白名单时仅托盘、不弹窗；
   - 点击外部收起、点击托盘重新打开、Esc 收起；
   - 二次启动唤起已有实例；
   - 托盘右键：Open / Settings / Open workspace / Quit。
2. **托盘菜单 i18n**
   - 当前 `window-manager.ts` 右键菜单为英文硬编码；接入 `settings.language` 或主进程翻译资源。

### P2 — 维护性

3. **继续拆分 `pages/app.tsx`**（当前 494 行）
   - 已抽出 `pages/popover/*` 组件与 `usePopoverSizing`；
   - 可把状态/处理器抽成 `usePopoverWorkflow` / `useSettingsSync`，让页面容器回到 300 行以内。
4. **更新/安装 UI 的打包态验证**
   - 设置页 UpdatesPanel 使用真实 `checkUpdates/downloadUpdate/installUpdate`；建议在打包产物中走一次 beta 通道检查与 SHA-512 失败路径。
5. **打包缓存/体积**
   - `dist/renderer/assets` 会保留历史指纹文件并被打进 asar；可在 build 前清理 `dist` 或设置 Vite `emptyOutDir`，减小安装包。

### P3 — 体验润色

6. 悬浮窗高度变化可加 `setBounds` 过渡（目前瞬时 resize）。
7. 托盘图标 16px/32px 两套尺寸分别提供，避免高 DPI 缩放模糊。
8. 设置页登记册面板的空态/长列表密度可继续优化。
9. 更新器 `latest.yml` 在 beta 通道的资产名/版本策略在真实发布后复核。

## 下次开始的位置

- 主进程窗口模型：`apps/desktop/electron/main/window-manager.ts`
- 窗口装配/IPC：`apps/desktop/electron/main/real-main.ts`
- 悬浮窗页面：`apps/desktop/src/pages/app.tsx` + `apps/desktop/src/pages/popover/*`
- 设置窗口：`apps/desktop/src/pages/settings/settings-app.tsx` + `settings-page.tsx`
- 自动保存：`apps/desktop/src/pages/settings/settings-autosave-controller.ts`
- e2e 双窗口 helper：`apps/desktop/tests/e2e/helpers/electron-launch.ts`
- 视觉系统：`apps/desktop/src/styles.css`

## 完成标准

- 托盘矩阵无阻塞问题；
- 分支 push 并按团队流程合并；
- 主工作区仍保持不动（所有改动只在 worktree 分支）。
