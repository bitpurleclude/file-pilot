# 发布强制便携版守卫（2026-10-29）

## 背景与调查结论

用户反馈「release 没有便携版」。对 GitHub 全部 release 资产逐一核查（`gh release view`）：

| Release | 日期 | NSIS Setup | Portable | latest.yml |
|---|---|---|---|---|
| v0.1.0-beta.1 / beta.2 | 2026-02-12 | — | — | —（仅 npm tgz） |
| v0.1.0-beta.3 – beta.6 | 2026-02-12 | 有 | **无** | 有 |
| v0.1.0-beta.7 | 2026-10-25 | 有 | 有 | 有 |
| v0.1.0（stable） | 2026-10-25 | 有 | 有 | 有 |
| v0.1.0-beta.9 | 2026-10-25 | 有 | 有 | 有 |

结论：**当前所有有效 release（2026-10-25 起）都已包含便携版**；缺便携版的是 2026-02-12 的历史 beta.3–beta.6（当时打包目标只有 NSIS），属历史遗留，不补发。

本地打包配置 `package.json` → `build.win.target = ["nsis", "portable"]` 一直同时产出两者；但发布工作流此前的「Ensure」步骤只检查「存在任一 exe」，若未来有人移除 portable target 或便携版构建失败，发布不会失败——该缺口由本次变更补上。

## 变更内容

`.github/workflows/release-publish.yml` 的 `Ensure installer and metadata exist` 步骤重写为
`Ensure setup, portable and update metadata exist`：

- 要求 `release/` 下同时存在：
  1. 名称不含 `Portable` 的 NSIS setup exe（供自动更新器）；
  2. 名称匹配 `*Portable*` 的便携版 exe（对应 `File-Pilot-${version}-Portable.exe` 命名）;
  3. `latest*.yml` 更新元数据（原有要求保留）。
- 任一缺失即 loud failure（`ENSURE_FAILED:` 标记 + throw，与 meta 步骤同风格），发布中止，不产出缺通道的 release。

## 发布信息

- 版本：不变更（当前 0.1.0）；守卫自**下一次发布**起在 CI 生效。
- 通道：同时作用于 stable（master 推送）与 beta（beta 分支推送）。
- 触发分支：本变更位于 `ci/require-portable-asset-20261029`（worktree `.worktrees/ci-portable-guard`）。
- 合并注意：master 推送受稳定 tag 守卫限制——需先 bump `package.json` 版本（如 0.1.1）才会通过；也可先合入 beta 通道推送验证。在合并推送前，本地与既有 release 行为完全不变。

## 更新文档增量

- 本文件（新增）为唯一文档变更；无代码/契约变化。

## 回滚说明

- `git revert <本提交>` 即可，仅回滚 workflow 守卫与本文档，无其他影响面。
- 不提供绕过开关：守卫失败意味着打包配置漂移（如 `win.target` 被改动），应修配置而非绕过守卫。

## 验证证据

验证基线：worktree `.worktrees/ci-portable-guard`，commit `bd82ef4`（master HEAD）之上。

| 命令 | 结果 |
|---|---|
| `npm ci` | exit 0（720 packages） |
| `npm run typecheck` | exit 0（0 错误） |
| `npm run lint` | exit 0（0 错误） |
| `npm run test` | 38 文件 / 276 测试全部通过 |
| `npm run build` | exit 0（renderer + electron/preload 产物齐全） |
| `npm run dist:win` | exit 0；产出 `File Pilot Setup 0.1.0.exe` + `File-Pilot-0.1.0-Portable.exe` + `latest.yml` |
| 守卫正向验证（pwsh 对真实 `release/` 目录执行同款逻辑） | `GUARD_PASS`（正确识别两个通道） |
| 守卫反向验证（目录仅含 Setup exe） | `ENSURE_FAILED: No portable asset found in release/*.exe`（按预期失败） |
| `npm run test:e2e:core` | 3/3 通过（startup 925ms / workflow 5.8s / rollback 10.4s） |
