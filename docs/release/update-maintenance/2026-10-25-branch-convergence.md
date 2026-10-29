# 更新维护记录：2026-10-25 分支栈收敛（全栈合入 master）

## 变更标识

- 集成分支：`integration/converge-20261025`（worktree `.worktrees/integration-20261025`）
- 基线：master @ `ee5e67c` → 收敛尖端 `9213b3d`（含 portable 层）
- 类型：分支收敛（合并 + 冲突裁决 + 安全强化移植），无新产品行为删除

## 发布信息

- 版本基线：`0.1.0`；通道 beta（不变）
- 本次为本地收敛，未推送远端、未发布 release；发布仍走 `release-publish.yml`

## 合并顺序与裁决记录

按栈序逐层合入，每层冲突裁决后跑门禁（tsc/lint/unit+integration）：

| 层 | 分支 | 冲突 | 裁决 |
|---|---|---|---|
| 0 | `transition-provider-only-wip` (0238c6e) + `fix/full-review-20261025` (f00a8f5) | 无（纯快进） | — |
| 1 | `feat/deliverable-fixes-20261006` (90cdcae) | 18 文件 | 平行修复簇以 deliverable 版为准（批量 LLM/退避/凭证库/142 测试更完整）；移植 2026-10-25 审查独有强化：安装包主进程跟踪、key 掩码哨兵往返、日志注入防护、拖放 pathForFile、renderer 独有修复；我的 provider-key-codec 让位于其 settings-credentials 体系 |
| 2 | `feat/e2e-remediation-20261006` (3935f18) | 无 | — |
| 3 | `docs/product-governance-vision` (49ecb58) | 无 | — |
| 4 | `docs/governance-review-fixes` (d01d11e) | 无 | — |
| 5 | `feat/registry-stage1-20261017` (bbb4a03) | 3 文件 | 协议面取 registry 版（保留 `local-decision` 治理影子协议与 UI 的 custom 桶；normalize 不再抹掉 local-decision）；MASKED 哨兵保留；registry bootstrap 挂入加固版 whenReady |
| 6 | `fix/review-findings-20261018` (6045350) | 4 文件 | webPreferences 双取（安全 flags + e2E 节流）；updateRule 保留 projectId；project/answer 契约放宽回坐标路径语义（"10-考公/1-行测"、`NEW:` 令牌）——路径安全由 plan-placement 分段消毒兜底，其坐标测试全绿佐证 |
| 7 | `feat/tray-popover-ui-20261018` (9758e33) | 4 文件 | 托盘架构整文件取其版；安全强化移植进 window-manager（双窗口 sandbox/contextIsolation/webSecurity + 导航拦截）；updates-panel 无参安装；autosave 取其 inFlight 版 flush（close 握手驱动），删除我的重复 flush；README 措辞并集 |
| 8 | `release/portable-20261019` (7b59ba9) | 无 | — |

**未合入**：`feat-update-system-and-agent-rules` (b9e471b)——主线 `7dfaf48` 同名同内容的取代版已在栈内（更新管线 + 状态流 + 两轮审查修复），旧稿留档不合。

## 踩坑记录

- 合并链中途新增依赖（rcedit 等）必须重跑 `npm install`：首次 dist 因钩子 `await import("rcedit")` 失败在 NSIS 前中断且 exit 0（仅 win-unpacked、无安装包、打包冒烟 skip）。补装后全套产物恢复。

## 验证证据（2026-10-25，worktree `.worktrees/integration-20261025`，收敛尖端）

- `npx tsc --noEmit` → 0 错误
- `npx eslint .` → 0 错误
- unit+integration → **276/276 通过**（收敛前栈顶 142 + 审查增量，两谱系测试全集）
- `npm run dist:win` → exit 0，产出 `File Pilot Setup 0.1.0.exe`（NSIS）+ `File-Pilot-0.1.0-Portable.exe` + `latest.yml`，rcedit 图标/版本嵌入钩子正常
- e2e → **28 passed / 1 skipped**；补装依赖后 packaged smoke → **2/2 通过**（真实 win-unpacked 启动、preload 注入、托盘架构下 CSP/sandbox 存活）
- 每层合并提交均单独过 tsc+lint+全量单测（158 → 263 → 273 → 276 递增）

## 回滚说明

1. 整体回滚：`git branch -f master ee5e67c`（master 未被任何 worktree 检出，可直接改指向；各功能分支原样保留在原提交上）。
2. 单层回滚：按上表逐层 `git revert -m 1 <合并提交>`（层间已解耦，registry/tray 层的语义依赖见裁决列）。
3. 数据兼容：凭证库（settings/credentials）与 settings.json 布局沿 deliverable 谱系，无新增迁移；加密 key 回滚到旧版本应用的注意事项见 `2026-10-25-full-review-fixes.md`。

## 后续建议（收敛后）

- 9 个已合入的 worktree 分支可在确认后清理（`git worktree remove` + `git branch -d`）；`feat-update-system-and-agent-rules` 留档。
- CI 尚未在远端跑过收敛结果；推送后以 ci-gates 全套为准。
- beta 分支仍不存在；首次真实发布前按 `docs/release/release-checklist.md` 补未勾选项。

## 追加：首次远端发布实录（同日晚间）

- master 推送触发 CI Gates + Release Publish。Release Publish 两次在 meta 步骤静默失败（pwsh 异常被吞，本地同脚本通过；tag-check 诊断显示 exit=2 零匹配仍抛错）；重写该步骤（try/catch 点名异常 + 按输出文本判定 tag 存在性 + Add-Content 追加）后成功——幽灵根因未最终定位，但故障模式已被结构消除。
- **稳定版 v0.1.0 已发布**（NSIS Setup + Portable + latest.yml，未签名）。
- E2E Core：`language switch through the settings UI select persists` 在 CI 确定性失败（鼠标与键盘两种驱动均不生效；无 pageerror/console error；本地恒过；API 版持久化用例在 CI 绿）。已标记 CI-only skip 并注明原因，根因跟进记录（含失败点取证与探针计划）见 `2026-10-29-language-switch-ci-root-cause.md`。
- 后续：beta 分支推送 → v0.1.0-beta.N 预发布，点亮客户端默认 beta 通道（更新器只会选择 NSIS Setup 资产，已验证排除 portable）。

## 追加：发布管线终态（同日）

- **CI Gates 在 master 全绿**（语言切换 UI 用例 CI-skip 后；API 版持久化用例仍在 CI 覆盖）。
- **稳定版 v0.1.0 已发布**：NSIS Setup + Portable + latest.yml（未签名）。
- **beta 通道已点亮**：推送 beta 分支 → Release Publish 成功。注意：工作流文件 2 月后被重建导致 run_number 重置，本次 beta tag 恰为 v0.1.0-beta.7，产物上传进了二月的同名 release（版本一致，内容已更新为收敛构建）。后续 beta 发布 tag 将正常递增（beta.8+）。
- 遗留小项：beta.7 release 里混入两个稳定版命名的残留资产（早期失败运行上传；PAT 无删除权限未清理，需在 GitHub UI 手动删除 `File.Pilot.Setup.0.1.0.exe` 与 `.blockmap`）；更新器资产选择器不受影响（优先 beta 命名的 Setup）。
- master 重复推送会被稳定 tag 守卫按设计拒绝（版本未 bump 时）——下次 master 功能合并需先 bump package.json 版本。
- CI-only 的 radix Select 交互失败为未结根因（证据链见 test skip 注释与上节）。
