# 交付记录：2026-10-18（review-fixes）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `fix/review-findings-20261018` |
| 日期 | `2026-10-18` |
| 基线 | `bbb4a03`（`feat/registry-stage1-20261017`，审查基线） |
| 修复提交 | `b7fc79a` |
| worktree | `.worktrees/review-fixes` |

## 变更清单

本次交付修复 2026-10-18 审查发现的问题：

- **P1 beta 更新版本方案**：发布工作流为 beta 构建注入 `v<base>-beta.<run>` 对应的实际版本（`npm version --no-git-tag-version`），使 `app.getVersion()` 与 release tag 一致；beta→beta 更新不再被 semver 判定为降级。stable 分支拒绝带 prerelease 后缀的版本。
- **P2 更新包完整性**：发布资产新增 `latest*.yml`；客户端下载 `latest.yml`、校验版本与 SHA-512、流式写入 `.download` 临时文件，校验通过后才原子替换；缺失元数据/摘要不符分别返回 `UPDATER_METADATA_MISSING` / `UPDATER_INTEGRITY_MISMATCH` 并清理临时文件。
- **P2 登记册名称与坐标一致性**：新增共享 `shared/validation/registry.ts`；领域/项目/别名在 IPC 与仓储两层拒绝路径分隔符、Windows 非法字符、保留设备名、边缘点/空格。坐标解析收敛为单实现，`coordinate-output` 与 `coordinate-resolution` 对 `30-考公/1-行测/extra` 等输入行为一致。
- **P2 `NEW:` 追题/修正落位**：`submitFollowup` / `saveCorrections` 在记录中保留 `NEW:` sentinel（提案可追溯），但 plan 使用剥离后的项目名；与 `process-session` 行为一致，不再产生 `NEW行测冲刺` 目录。
- **P3 `classification_rules.project_id` 接线**：`ClassificationRule` / `RuleUpdatePayload` 增加 `projectId`；仓储 create/update 读写该列；坐标修正学习规则时写入实际 `projectId`。
- **P3 `sample_paths` 积累**：`PlacementPlan.coordinate` 携带可选 `areaId/projectId`；新增 `recordCoordinateSamples`，在 analyze、追问、修正后把 coordinated 条目的源路径写入登记册（best-effort，项目已归档时不阻断主链）。
- **P3 UI 健壮性**：registry-panel 的 IPC 调用全部捕获 rejection；非法名称在本地禁用创建并跳过实时查重；e2e HTML reporter 输出移出 `test-results`，消除每次运行的 Configuration Error。
- **文档同步**：修正治理设计项目编号示例、README 功能/IPC 列表、release 索引与 runbook、registry-stage1 验证计数；新增 `qa-acceptance.md`（修复 README 失效链接）。

## 更新文档变更

- `docs/product/governance-design.md`：项目编号示例统一为 `30-考公/1-行测`；新增 v1.2 修订记录。
- `README.md`：功能列表加入治理层阶段①；补充 registry IPC 通道。
- `docs/release/README.md`：beta/stable tag 规则、`latest*.yml` 资产要求、交付记录索引与回滚说明。
- `docs/release/update-runbook.md`：版本注入、`latest.yml` 上传、下载完整性校验、错误码与回滚步骤。
- `docs/release/registry-stage1-20261017.md`：验证基线/计数校正；已修 backlog 标注。
- `docs/release/qa-acceptance.md`：新增 QA 验收说明（性能/回滚可靠性/决策基准）。
- 新增本交付记录。

## 回滚说明

- 代码回滚：`git revert b7fc79a`；未合并前可直接 `git reset --hard bbb4a03`。
- 数据库回滚：本次不新增迁移；`classification_rules.project_id` 来自 `0004_registry.sql`。回滚后旧代码忽略该列与 `sample_paths`，无需降级数据库。
- 更新缓存：回滚前建议删除 `%APPDATA%\File Pilot\updates\*`，避免旧版客户端复用新流程下载的文件。
- 用户数据：设置、日志、会话与登记册均在 `%APPDATA%\File Pilot`，回滚不删除。

## 验证证据

执行环境：Windows 11（win32 10.0.26100 x64）、Node `v24.13.0`、npm `11.6.2`。worktree：`.worktrees/review-fixes`；修复提交 `b7fc79a`（基于 `bbb4a03`）。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过（exit 0） | 修复后复验 |
| `npm run lint` | 通过（exit 0） | 0 错误 0 警告 |
| `npm run test` | 通过（exit 0） | **35 文件 / 257 用例**（基线 33/247 + 10 个新增回归用例） |
| `npm run test:qa` | 通过（exit 0） | 3 文件 / 3 用例（性能、回滚可靠性、决策基准） |
| `npm run build` | 通过（exit 0） | renderer + electron bundle + 迁移/模板复制 |
| `npx playwright test --list` | 通过（exit 0） | 29 tests / 12 files；不再出现 reporter folder clash |

新增回归覆盖：

- `apps/desktop/tests/unit/check-updates.test.ts`：beta→beta 可用、`latest.yml` 缺失拒绝、SHA-512 不符拒绝并清理、正常校验下载。
- `apps/desktop/tests/unit/registry-name-validation.test.ts`：IPC 与仓储两层拒绝 `/`、`\`、Windows 非法字符、`CON`、`..`、别名非法值；正常名称 trim。
- `apps/desktop/tests/unit/coordinate-output.test.ts`：与 placement resolver 对全部样本一致；多段坐标判非法。
- `apps/desktop/tests/unit/registry-repository.test.ts`：`createRuleSqlite` 持久化并读回 `project_id`。
- `apps/desktop/tests/integration/session-handlers-coordinates.test.ts`：追问 `NEW:` plan 剥前缀、坐标修正保留 coordinated 落位、样本路径入库、学习规则带 `projectId`。

未在本次复跑（按 owner 要求停止长耗时测试）：完整 Playwright e2e 与 `npm run dist:win`。registry 向导 e2e 在基线 `bbb4a03` 上曾 2/2 通过；e2e 全量结论以 `registry-stage1-20261017.md` 的历史记录为准。

## 已知剩余事项

- 提案“忽略”仍只在前端隐藏，刷新后复现；同名提案未去重。
- `classifyMany` 分块仍以首条坐标清单为准（当前唯一调用方同质）。
- 实时查重对已配置 API Key 的用户仍可能每次防抖停顿触发语义判官调用（成本 backlog）。
- 真实 Laya 端点运行时评测待模型下载。
