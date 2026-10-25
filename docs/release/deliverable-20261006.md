# 交付记录：2026-10-06（deliverable-fixes）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `feat/deliverable-fixes-20261006` |
| 日期 | `2026-10-06` |
| 产物形态 | NSIS 安装包 + 便携版（Portable） |

## 变更清单

本次交付修复的问题域：

- 测试门禁：修复 EBUSY 与 worktree 污染问题。
- 安全：修复白名单路径前缀绕过。
- 安全：补齐目标路径清洗。
- 执行：批量执行部分失败可回滚。
- 执行：实现 `conflictPolicy`。
- LLM：批量分类。
- LLM：重试分类。
- LLM：usage 观测。
- LLM：temperature 配置化。
- 安全：API Key 加密存储接线。
- 安全：安装器路径校验。
- 安全：只读模式主进程校验。
- 交互：追问（follow-up）只作用于待追问条目。
- 渲染层：会话 ID、调试输出、类型错误修复。
- 更新器：流式下载与 prerelease 版本比较。
- 更新器：自动更新只选择 NSIS 安装包资产，永不误选便携版 exe。
- 质量：清理重复实现（路径段清洗、路径包含判断）与死代码；凭据文件原子写入；同秒同名冲突重命名加序号；`skipped` 不再计为失败。
- 打包：新增便携版（Portable）打包目标，`npm run dist:win` 同时产出 NSIS 安装包与 `File-Pilot-0.1.0-Portable.exe`；补充 `repository` 字段使 electron-builder 能生成更新元数据。

## 更新文档变更

- `package.json`：`build.win.target` 增加 `portable`；新增 `build.portable.artifactName`（`File-Pilot-${version}-Portable.exe`）。
- `README.md`：
  - 打包发布章节补充便携版产物 `release/File-Pilot-0.1.0-Portable.exe` 及数据目录（`%APPDATA%\File Pilot`）说明。
  - 常用命令补充注明 `npm run dist:win` 同时产出两种包。
- `docs/release/update-runbook.md`：追加"便携版发布注意事项"一节（产物命名、分发方式、数据目录说明）。
- `docs/release/README.md`：索引中加入本交付记录（`deliverable-20261006.md`）链接。
- 新增 `docs/release/deliverable-20261006.md`（本文件）。

## 回滚说明

- 代码回滚：在对应分支对本次交付提交执行 `git revert`（可按提交逐个 revert 或按提交区间 revert），回到上一个可用版本后重新走构建/打包流程。
- 安装版回滚：卸载当前版本后，重新安装上一版 NSIS 安装包（上一个可用构建的 `File Pilot Setup <version>.exe`）。
- 便携版回滚：直接用旧版 `File-Pilot-<version>-Portable.exe` 替换当前文件即可，无安装/卸载步骤。
- 用户数据：运行时数据位于 `%APPDATA%\File Pilot`，卸载或回滚不会删除该目录，用户数据不受影响。
- 配置兼容：若在当前版本已完成 LLM Provider 配置迁移，回滚到旧版本后首次启动会走 legacy 迁移逻辑，配置可兼容读取。

## 验证证据

执行环境：Windows 11（win32 10.0.26100 x64）、Node 20+、npm。worktree：`.worktrees/deliverable-fixes`。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过（exit 0） | 修复前基线存在 1 个 `app.tsx(376)` exactOptionalPropertyTypes 错误，已修复 |
| `npm run lint` | 通过（exit 0） | 0 错误 0 警告 |
| `npm run test` | 通过（exit 0） | 26 个测试文件 / 142 个用例全部通过；修复前基线为 3 个 EBUSY 失败 |
| `npm run test:qa` | 通过（exit 0） | QA 性能与回滚可靠性阈值用例通过 |
| `npm run build` | 通过（exit 0） | renderer + electron 产物完整（dist/renderer、dist/electron/main.cjs、preload.cjs、模板与迁移文件） |
| `npm run dist:win` | 通过（exit 0） | 同时产出 `release/File Pilot Setup 0.1.0.exe` 与 `release/File-Pilot-0.1.0-Portable.exe`，并生成 `release/latest.yml` 更新元数据（指向 NSIS 安装包） |
| `npx playwright test`（含 `FILE_PILOT_RUN_PACKAGED_SMOKE=1`） | 通过 | 7/7 通过：启动、错误路径、规则学习、SQLite 迁移、工作流，以及真实启动 `release/win-unpacked/File Pilot.exe` 的打包 smoke |

执行过程说明：

- 基线阶段：`npm run test` 有 3 个失败（`updater-handlers.test.ts` 的 Windows EBUSY），且根目录 vitest 会收集 `.worktrees/` 副本导致 66 个测试文件（污染门禁）。两问题均已修复。
- 评审阶段：终审 agent 对全量 diff 复查，确认规格全部落地；其提出的 1 个 P1（更新器可能误选便携版 exe 作为自动更新资产）与全部可修 P3（重复实现、死代码、原子写入、同秒冲突、skip 计为失败）已在本分支修复并补充回归测试后复跑门禁。
- e2e 修复：`startup/migration/package-smoke` 三个 spec 断言的标题停留在 i18n 之前的旧值（`File-Pilot M2/M3`，实际为 `File-Pilot`），`workflow` spec 的追问断言依赖已修复的"applyToAll 覆盖全部条目"旧行为——均按当前正确行为更新。
- 残余风险：应用图标未设置（electron-builder 使用默认图标）；代码签名按现阶段策略关闭（`forceCodeSigning: false`）。
