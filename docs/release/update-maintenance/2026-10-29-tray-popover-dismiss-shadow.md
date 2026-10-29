# 托盘悬浮窗：去除失焦自动隐藏 + 修复阴影（2026-10-29）

## 背景

用户报告两个问题：

1. 托盘弹出的悬浮窗，鼠标在别处一点就自动消失，基本不可用；
2. 悬浮窗附近有一圈很难看的阴影。

## 根因（实现路径与引擎分析）

**问题 1 —— 失焦自动隐藏**：`apps/desktop/electron/main/window-manager.ts` 中 popover 窗口注册了 `blur` 事件，失焦 120ms 后自动 `hide()`（仅豁免 DevTools 与设置窗聚焦）。后果：从资源管理器拖文件进悬浮窗（拖拽起点即夺焦）、点击任意其他窗口，悬浮窗都会消失——与"拖文件进来"这一核心工作流直接冲突。

**问题 2 —— 双重阴影**：popover 窗口为 `transparent: true, frame: false, hasShadow: true`。Windows 上 Electron 透明无边框窗口的原生 DWM 阴影**跟随矩形窗口边界**，而渲染层卡片是 20px 圆角——于是圆角卡片外叠出一圈方形硬阴影；同时渲染层 CSS 阴影（`0 26px 60px`）远超窗口预留的 7px 透明边距，被窗口边界硬裁切。两层叠加即"难看的阴影"。

**引擎层结论**：transparent + frameless 窗口的原生阴影必然是矩形，这是 DWM 的行为而非可配置项；rounded flyout 的正确做法即关闭原生阴影（`hasShadow: false`）、由渲染层 CSS 绘制并预留边距。替代方案（`thickFrame: false` / 非透明窗口）会失去透明与圆角能力，不可取。本变更按此实现。

## 变更内容

- `window-manager.ts`：
  - 删除 popover `blur` 自动隐藏处理。显式关闭路径（均已存在）：Esc、卡片关闭按钮、托盘图标点击切换、打开设置时隐藏。保留 250ms 托盘重开守卫。
  - `hasShadow: true` → `false`，附约束注释。
  - 窗口尺寸 396×640 → 428×672：四周 16px 透明边距容纳 CSS 阴影，**卡片可视尺寸不变**（396×640）。
- `styles.css`：
  - `.popover-stage` padding 7px → 16px；
  - `.popover-card` 阴影由 `0 26px 60px`（超边距被裁切）改为收敛的 `0 4px 12px rgba(0,0,0,0.55)`（完全落在边距内，无裁切；内高光与 1px 描边环保留）。
- `docs/architecture/tray-ui.md`：同步失焦行为与阴影实现描述。

## 发布信息

- 版本：不变更（当前 0.1.0）；随下一次 beta/stable 发布带上。
- 分支：`fix/tray-popover-dismiss-shadow-20261029`（worktree `.worktrees/fix-tray-popover-20261029`，基于 master `bd82ef4`）。
- 合并注意：master 推送受稳定 tag 守卫限制，需先 bump `package.json` 版本；或随 beta 通道推送。

## 更新文档增量

- `docs/architecture/tray-ui.md`（行为与阴影描述同步，本次唯一文档变更）+ 本文件。

## 回滚说明

- `git revert <本提交>` 即可恢复失焦自动隐藏与原生阴影；无数据/契约影响面。

## 验证证据

验证基线：worktree `.worktrees/fix-tray-popover-20261029`，`bd82ef4` 之上。

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0（0 错误） |
| `npm run lint` | exit 0（0 错误） |
| `npm run test` | 38 文件 / 276 测试全部通过 |
| `npm run build` | exit 0 |
| `npm run test:e2e:core` | 3/3 通过（startup / workflow / rollback） |
| `npm run test:e2e`（全量） | 27 通过 / 2 跳过（package-smoke 需 `FILE_PILOT_RUN_PACKAGED_SMOKE=1`，原有行为）；语言切换用例本地通过 |
| 视觉验证 | 以本地静态服务器渲染 `dist/renderer/index.html?view=popover`（428×672 视口）截图：圆角卡片 + 柔和收敛阴影，无方形硬阴影、无裁切痕迹 |

已知限制：失焦行为变更无自动化 e2e 覆盖（托盘点击与窗口失焦难以在 Playwright 中注入），依据为代码路径删除 + 上述视觉验证；`resizePopover` 渲染层当前未调用，窗口尺寸变更无布局连锁。
