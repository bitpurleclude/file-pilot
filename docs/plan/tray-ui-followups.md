# Tray UI 交接与待办（2026-10-19）

## 当前状态

- 分支：`feat/tray-popover-ui-20261018`
- worktree：`.worktrees/tray-ui`
- 当前提交：`34a694c`（基线 `6045350`）
- 已完成：托盘常驻、无边框自适应悬浮窗、独立设置窗口、深色视觉系统、规则/更新设置页、白名单持久化修复、窗口 IPC、隐藏窗口 e2e 适配、应用/托盘图标。
- 未合并、未 push；主工作区未改动。

## 已验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test` | 35 文件 / 257 用例通过 |
| `npm run build` | exit 0 |
| 隐藏 UI/启动 e2e | 12/12 通过（startup、ui-onboarding 4、ui-settings 6、registry-wizard 1） |
| 单条设置回归 | `settings-back` 竞态修复后 1/1 通过 |
| 托盘冒烟 | 生产模式（tray enabled + 已配置白名单）`isReady=true`、悬浮窗 `visible=false` |
| 视觉检查 | onboarding / ready popover / settings general / settings registry 截图检查通过 |

## 下次继续（按优先级）

### P0 — 发布前必须完成

1. **全量 e2e 复跑**
   - 上次全量：25 passed / 2 skipped / 1 failed（`settings-back` 关闭窗口的点击竞态）。
   - 已在 `helpers/electron-launch.ts:closeSettingsWindow` 加 `.catch(() => undefined)`；单条复跑通过。
   - 命令：
     ```bash
     npm run build
     npm run native:rebuild:electron
     npx playwright test
     ```
   - 预期：26 passed / 2 skipped（2 个 package-smoke 自跳过）。若仍失败，先看 `settings-back` 与第二个 BrowserWindow 的关闭时序。
2. **打包验证**
   - 命令：`npm run dist:win`
   - 检查：
     - `resources/icon.ico` 被 electron-builder 接受，安装器/窗口图标正确；
     - `dist/electron/assets/tray-icon.png` 与 `app-icon.png` 进入 `dist/**/*`；
     - 安装包与 portable 均产出；
     - `FILE_PILOT_RUN_PACKAGED_SMOKE=1 npx playwright test apps/desktop/tests/e2e/package-smoke.spec.ts`
   - 风险：`resources/icon.ico` 是单张 256px PNG-compressed ICO；如果 electron-builder 拒绝，改用多尺寸 ICO（16/32/48/256）。

### P1 — 交互可靠性

3. **托盘人工验证矩阵**
   - 多显示器（副屏任务栏）、任务栏在顶部/左侧、125%/150% 缩放；
   - 首次启动（无白名单）自动弹出 onboarding；已有白名单时仅托盘、不弹窗；
   - 点击外部收起、点击托盘重新打开、Esc 收起；
   - 二次启动唤起已有实例；
   - 托盘右键：Open / Settings / Open workspace / Quit。
4. **设置窗口关闭时的防抖保存**
   - 现状：`SettingsPage` 的 autosave 控制器 600ms 防抖；直接关闭窗口可能丢掉最后一次未提交修改。
   - 方案：关闭前 flush pending save（主进程 `closeSettings` 与渲染层握手），或在 `beforeunload` 触发保存；补一条 e2e/单测。
5. **托盘菜单 i18n**
   - 当前 `window-manager.ts` 右键菜单为英文硬编码；接入 `settings.language` 或主进程翻译资源。

### P2 — 维护性

6. **继续拆分 `pages/app.tsx`**（当前 494 行）
   - 已抽出 `pages/popover/*` 组件与 `usePopoverSizing`；
   - 可把状态/处理器抽成 `usePopoverWorkflow` / `useSettingsSync`，让页面容器回到 300 行以内。
7. **删除死代码**
   - `apps/desktop/src/pages/components/rule-management-panel.tsx` 已被 `settings/panels/rules-panel.tsx` 取代，当前无引用。
8. **补齐文档中的数据**
   - P0 完成后把全量 e2e 与 `dist:win` 结果回填 `docs/release/tray-popover-ui-20261018.md`。
9. **更新/安装 UI 的打包态验证**
   - 设置页的 UpdatesPanel 使用真实 `checkUpdates/downloadUpdate/installUpdate`；建议在打包产物中走一次 beta 通道检查与 SHA-512 失败路径。

### P3 — 体验润色

10. 悬浮窗首次出现、计划增长时的窗口高度过渡可加 `setBounds` 动画（目前瞬时 resize）。
11. 托盘图标 16px/32px 两套尺寸可分别提供，避免高 DPI 下的缩放模糊。
12. 设置页登记册面板的空态/长列表密度可继续优化（当前功能完整，视觉可再压紧）。

## 下次开始的位置

- 主进程窗口模型：`apps/desktop/electron/main/window-manager.ts`
- 窗口装配/IPC：`apps/desktop/electron/main/real-main.ts`
- 悬浮窗页面：`apps/desktop/src/pages/app.tsx` + `apps/desktop/src/pages/popover/*`
- 设置窗口：`apps/desktop/src/pages/settings/settings-app.tsx` + `settings-page.tsx`
- e2e 双窗口 helper：`apps/desktop/tests/e2e/helpers/electron-launch.ts`
- 视觉系统：`apps/desktop/src/styles.css`

## 完成标准

- P0 两项全绿并回填交付记录；
- P1 托盘矩阵无阻塞问题；
- 分支 push 并按团队流程合并；
- 主工作区仍保持不动（所有改动只在 worktree 分支）。
