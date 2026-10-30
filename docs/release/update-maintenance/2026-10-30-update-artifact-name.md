# 更新器安装包命名修复 / v0.1.2（2026-10-30）

## 背景

发布 v0.1.1 后的更新链路核验发现 **stable/beta 通道的自动更新自 0.1.0 起处于断链状态**，两个叠加原因：

1. **安装包资产命名不一致（本变更修复）**：`nsis.artifactName` 未设置时用默认名 `File Pilot Setup <version>.exe`（含空格）。electron-builder 对两处做了不同的空格清洗——写入 `latest.yml` 的更新 URL 用连字符（`File-Pilot-Setup-0.1.1.exe`），上传 GitHub 的资产名用点号（`File.Pilot.Setup.0.1.1.exe`）。electron-updater 按 latest.yml 的 URL 拼下载地址，与资产名永远对不上 → 更新下载 404。stable 0.1.0 / 0.1.1 与全部 beta 均受影响（取证：各 release 的 `latest.yml` 内容 vs 资产名比对，2026-10-30）。
2. **仓库为私有**（另行决策，见下）：未认证客户端无法拉取 `latest.yml`，自动更新对任何安装客户端（无仓库 token）都不可用。此项不是代码问题，需要仓库可见性或发布源的独立决策。

## 变更内容

- `package.json` → `build.nsis.artifactName = "File-Pilot-Setup-${version}.${ext}"`：安装包名不含空格后，latest.yml URL、本地产物名、GitHub 资产名三者天然一致，消除清洗分歧（便携版此前已是同类命名 `File-Pilot-${version}-Portable.exe`，未受影响）。
- `package.json` 版本 bump **0.1.1 → 0.1.2**（master 稳定 tag 守卫要求；旧客户端不会通过更新器拿到本版，见上）。
- `AGENTS.md` §4：安装包路径与「产物名禁止空格」约束写入规范。

## 发布信息

- 版本：**0.1.2**；通道：stable；触发分支：master（推送即发布，待推送）。
- 首个会通过新的守卫 + 新命名的发布；发布后应核验 release 资产名 == `File-Pilot-Setup-0.1.2.exe` 且 `latest.yml` 的 `files[0].url` 与之一致。
- 已发布的历史版本（0.1.0 / 0.1.1 / 各 beta）的 latest.yml 与资产名不一致，**其存量客户端自动更新无法到达 0.1.2**，需手动下载安装；如需救回存量用户可手工替换 release 资产名为连字符命名（或重传对齐 latest.yml），另行决定。

## 更新文档增量

- `AGENTS.md` §4（本次唯一文档变更）+ 本文件。

## 回滚说明

- `git revert <本提交>` 恢复默认命名；已发布的 0.1.2 资产不受 revert 影响（回滚只作用于未来发布）。

## 验证证据

验证基线：worktree `.worktrees/fix-update-artifact-name-20261030`，master `13e58ca` 之上。

| 命令 | 结果 |
|---|---|
| `npm run typecheck` / `lint` | exit 0（0 错误） |
| `npm run test` | 38 文件 / 276 测试全部通过 |
| `npm run build` | exit 0 |
| `npm run dist:win` | exit 0；产物 `File-Pilot-Setup-0.1.2.exe` + `File-Pilot-0.1.2-Portable.exe` + `latest.yml` |
| **命名一致性核验** | 本地 `release/latest.yml` 的 `files[0].url` = `File-Pilot-Setup-0.1.2.exe` = 磁盘产物名（空格清洗分歧不再存在） |
| `npm run test:e2e:core` | 3/3 通过 |
