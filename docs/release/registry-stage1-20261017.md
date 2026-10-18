# 交付记录：2026-10-17（registry-stage1，治理层阶段①）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `feat/registry-stage1-20261017` |
| 日期 | `2026-10-17` |
| 基线 | `d01d11e`（`docs/governance-review-fixes`：产品文档 + ADR-0002 + Dry-run 决策追认） |
| 实施方式 | 5 个实施 agent（R1/R2/R3 并行 + R4b/R5b 续作）+ 1 个终审 agent + 协调者集成 |

## 变更清单

对应 `docs/product/roadmap.md` 阶段①全部范围：

- **登记册数据层**：迁移 `0004_registry.sql`（`registry_areas`/`registry_projects`、活跃名称大小写不敏感唯一索引、`classification_rules.project_id` 关联）；`registry-repository`（空号认领 10..80 / x1..x9、归档占号不回收、活跃坐标、样本路径、NEW: 提案读取）；bootstrap 表校验；槽位/重名专用错误码。
- **坐标核心**：`coordinate-resolution.ts` 纯函数（坐标串解析、清单精确匹配、`NEW:` 提案、coordinated 目标构造——**名称经 sanitizePathSegment 消毒**）；`PlacementPlan.coordinate/uncoordinated`、`Classification.proposedProject`（workflow.ts 仅追加可选字段）；plan-placement 双轨（coordinated 不带时间桶，uncoordinated 保留 legacy 全部行为）；process-session 透传坐标；decision 记录闭环（NEW: 经 project 列被 listProposals 消费）。
- **LLM 坐标认领**：两个模板坐标清单条件段（**无坐标时渲染与基线逐字节一致**，有持久化测试守护）；`coordinate-output.ts` 输出三态校验（claimed/new/invalid）；rule-first-llm 消费与降级链（invalid → 逐条/兜底 + `coord:*` 审计 reason）；llm-stub `coordinateMode`。
- **建域向导（出生协议）**：settings 页新 registry Tab；域/项目两级管理；**三级查重**（exact 大小写归一 / similar 编辑距离+bigram+后缀规则 ≥0.82 / semantic LLM 判官，exact 阻断、similar/semantic 放行带警告）；DB 层大小写不敏感唯一索引兜底（并发窗口防线）；六个 registry IPC 通道 + preload 白名单 + 启动自动创建 `00-Inbox/90-Archive/99-Temp` 容器目录；26 个新 locale key。
- **本地决策模型影子模式（T1）**：`ProviderProtocol.local-decision` + decisionMode/endpointPath；`shadow-runner` 两级分解旁路（默认 `enabled:false` 全链路零开销；fire-and-forget 不入主链）；迁移 `0005_shadow.sql` + 汇总仓储；QA 基准 harness（13 条中文语料 + mock 端点，报告落 `test-results/qa/decision-benchmark-*.json`，实测 agreeRate 脚本可校准）。运行时评测待模型下载（接口/harness 已就绪）。
- **追问/修正坐标保持**（终审 P2-3）：submitFollowup/saveCorrections 重建 plan 时走 `resolveProjectClaim`——修正答案命中坐标保持 coordinated，`NEW:` 转提案，不再静默回退。
- **终审修复**：P1 coordinated 路径名称消毒；P2-1 NEW 前缀大小写两层对齐；P2-2 DB 级 CI 唯一索引 + UNIQUE 违规映射 `REGISTRY_DUPLICATE_NAME`；P3 toDecisionRecords 移除被存储层丢弃的误导字段。

## 更新文档变更

- `docs/product/roadmap.md`：阶段①状态待本交付后标记（下次文档提交回填）。
- 其余产品文档（vision/governance-design/decision-models/research-notes/ADR-0002）本阶段无行为性变更，未改动。
- 新增本交付记录。

## 回滚说明

- 代码回滚：本分支提交执行 `git revert`，或 `git reset --hard d01d11e`（未合并前）。
- 数据库回滚：迁移 0004/0005 为新增表与列（`classification_rules.project_id` 为可空追加），旧代码可正常打开新库；回滚不需要降级数据库。
- 行为回滚：坐标管线为双轨设计——清空登记册（或回滚到基线代码）后所有落位自动回到 legacy purpose/project 形态，存量文件无需搬家。
- 用户数据：本交付不触碰 `%APPDATA%` 真实目录（e2e 隔离已验证）；登记册数据位于隔离/应用 userData 内。

## 验证证据

执行环境：Windows 11（win32 10.0.26100 x64）、Node 20+。worktree：`.worktrees/registry-stage1`。
验证基线 commit：`bbb4a03`（本文件所在提交）。2026-10-18 复核时复跑了 typecheck/lint/test/test:qa/build 与 registry-wizard e2e；全量 e2e 和 `dist:win` 未在本轮复跑。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过（exit 0） | 终审修复后复验 |
| `npm run lint` | 通过（exit 0） | |
| `npm run test` | 通过（exit 0） | **33 文件 / 247 用例**（registry 仓储 10、坐标解析 18、坐标输出 20、查重 16、handlers 8、影子 12 及全部回归） |
| `npm run test:qa` | 通过（exit 0） | **3 文件 / 3 用例**（性能、回滚可靠性、决策基准 harness）；与 test 合计 36 文件 / 250 用例 |
| `npm run build` | 通过（exit 0） | 模板坐标段随构建复制 |
| `npx playwright test` | 记录为 **27 通过 / 0 失败 / 2 跳过** | 2026-10-18 仅复跑 `registry-wizard.spec.ts`（2/2 通过）；全量 e2e 未复跑 |
| `FILE_PILOT_RUN_PACKAGED_SMOKE=1` 打包 smoke | 2/2 通过（历史记录） | 真实启动 win-unpacked 产物；本轮未复跑 |
| `npm run dist:win` | 通过（exit 0，历史记录） | NSIS + Portable + latest.yml；本轮未复跑 |
| 隔离证明 | 通过 | e2e 全程 `%APPDATA%\Electron`/`%APPDATA%\file-pilot` mtime 不变 |

## 已知事项与 backlog

已由 `review-fixes-20261018.md` 修复：registry-panel 未捕获 IPC reject、`NEW:` 追问/修正落位路径、`classification_rules.project_id` 未接线、`sample_paths` 未积累、登记册名称路径字符校验、坐标解析双实现、更新器元数据校验。

仍保留：
- NEW: 提案「忽略」仅前端隐藏，刷新后复现；同名提案不去重。
- classifyMany 分块以 chunk[0].coordinates 为准（当前唯一调用方保证同质；自定义直接调用者需注意）。
- 实时查重对已配置 apiKey 的用户每次防抖停顿可能发起 LLM 判官调用（无缓存）——成本优化 backlog。
- 真实 Laya 端点运行时评测待模型下载；harness/接口已就绪，替换 baseUrl 即可。
