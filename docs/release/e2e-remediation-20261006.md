# 交付记录：2026-10-06（e2e-test-isolation 整改）

## 发布信息

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.0` |
| 渠道 | `beta` |
| 触发分支 | `feat/e2e-remediation-20261006` |
| 日期 | `2026-10-06` |
| 基线 | `90cdcae`（交付分支 `feat/deliverable-fixes-20261006`） |
| 变更性质 | 测试基建与文档 + **渲染层 bug 修复**（见变更清单第 2 项，已重打安装包） |

## 变更清单

本次 e2e 整改覆盖的问题域：

- 测试隔离：electron-launch helper 自动注入 `FILE_PILOT_USER_DATA_DIR` / `FILE_PILOT_WORKSPACE_ROOT`，e2e 全部落在临时目录，永不触碰 `%APPDATA%` 下真实 userData 与真实用户文件；新增 `isolation.spec.ts` 验证隔离生效。
- **渲染层 bug 修复（UI e2e 发现）**：`app.tsx` bootstrap effect 对同语言调用 `changeLanguage` 导致 i18next 每次发 `languageChanged`、`t` 引用不稳定、App 无限重渲染——设置草稿被高频回写，**UI 上的设置改动从不落盘**；同根源还导致消息提示被覆盖、自动保存状态条不更新（autosave controller 因 `onSettingsChange` 引用不稳被重建）。修复：同语言守卫、消息 effect 依赖改 `[i18n.language]`、`handleSettingsChange` 加 `useCallback`；`settings-page.tsx` 修复自动保存向 strict 合约发送被拒的 `whitelistDirectories`（改由 `saveWhitelist` 通道管理）。已重打 NSIS/便携版安装包。
- LLM stub：新增 `helpers/llm-stub.ts` 确定性 LLM stub，e2e 不发起真实 LLM 请求；新增 `llm-success.spec.ts` 覆盖分类成功链路（含"3 文件仅 1 次批式调用"的降成本端到端证明、401 不重试不切备模型、非法 JSON 降级）。
- 真实回滚 e2e：新增 `rollback.spec.ts`，覆盖真实 move 执行后回滚、源文件恢复原位、内容一致。
- UI 交互 e2e：新增 `ui-onboarding.spec.ts`（首启向导、只读跳过、拖拽导入、新会话）与 `ui-settings.spec.ts`（设置页自动保存、只读开关、语言切换持久化、LLM 供应商管理），并为主页面/设置页补充 `data-testid`/`aria-label` 可测性标注。
- 存量 spec 确定性化：error-path/workflow/rule-learning/migration 接入 LLM stub，消除对真实网络失败的依赖。
- 门禁恢复：过期断言（`File-Pilot M2/M3` 旧标题、applyToAll 旧行为）已按当前正确行为修复；新增本地核心门禁 `npm run test:e2e:core`（startup/workflow/rollback 三件套）并写入 AGENTS.md pre-commit/DoD。
- CI 修正：删除 e2e-gates 中无用的 `npx playwright install chromium`；e2e-gates 改为运行全量 `npx playwright test`（package-smoke 无 `FILE_PILOT_RUN_PACKAGED_SMOKE` 时自动跳过），UI spec 与存量 spec 全部纳入 CI。
- Playwright 配置强化：`forbidOnly`、CI `retries: 1`、`trace: "on-first-retry"`、`screenshot: "only-on-failure"`、HTML 报告输出到 `test-results/e2e-html`，失败时有现场可查。
- 文档修复：`apps/desktop/tests/e2e/README.md` 重写（标题 `File-Pilot`、spec 清单、测试隔离章节、LLM stub 章节、MCP 章节标题引用修正）；`README.md` 常用命令与测试策略补充。
- QA 批式覆盖：`apps/desktop/tests/qa/performance-100-files.test.ts` mock classifier 补充 `classifyMany`，统计批量调用次数（`batchCalls`）并断言 ≥1，证明 100 文件性能测试走批式分类路径；QA 报告对象新增 `batchCalls` 字段；8s/20s 阈值不变。
- 数据污染清理：备份式清理 e2e 历史污染（`%APPDATA%\Electron` 整目录改名为 `Electron.e2e-pollution-backup-20261006`；`%APPDATA%\file-pilot` 的 settings.json 白名单重置为空（原值指向已删除的测试临时目录）、`data.db` 中 e2e 产生的 session/decision 行清除，两者均有 `.before-cleanup-20261006` 备份）。
- P3 收尾：provider 重定向样板收敛为 `apps/desktop/tests/e2e/helpers/provider-redirect.ts`（error-path/workflow/rule-learning/migration/rollback/llm-success 六个 spec 复用），与 electron-launch mkdtemp 失败清理补强（userData 建成后 workspace mkdtemp 抛错时同样清理已建临时目录，不再泄漏）。

## 更新文档变更

- `playwright.config.ts`：新增 `forbidOnly`/`retries`/`trace`/`screenshot`/HTML reporter 配置。
- `package.json`：scripts 新增 `test:e2e:core`（仅 scripts 段）。
- `.github/workflows/ci-gates.yml`：e2e-gates 移除 Playwright 浏览器安装步骤，spec 清单更新为全部核心 spec；package-smoke-gate 保持不变。
- `AGENTS.md`：第 3 节命令清单补充 `test:e2e:core`；"Typical pre-commit verification" 与第 11 节 Definition of Done 纳入本地 e2e 核心门禁（打包/e2e 相关改动必须，纯文档改动可跳过）。
- `README.md`：常用命令补充 `test:e2e:core`；测试策略补充 e2e 隔离与 LLM stub 说明。
- `apps/desktop/tests/e2e/README.md`：重写过期内容（标题、spec 清单、测试隔离、LLM stub、MCP 章节标题引用）。
- `apps/desktop/tests/qa/performance-100-files.test.ts`：mock classifier 增加 `classifyMany` 与批式路径断言。
- `docs/release/README.md`：索引中加入本交付记录。
- 新增 `docs/release/e2e-remediation-20261006.md`（本文件）。

## 回滚说明

- 代码回滚：在本分支对本次整改提交执行 `git revert`（逐个或按区间），即可回到基线 `90cdcae`；`git reset --hard 90cdcae` 仅在分支未合入前可用。
- 影响面：本分支包含两个渲染层 bug 修复（设置保存失效、消息提示被覆盖），因此**重打了** NSIS 安装包与便携版。若整体回滚，需用基线 `90cdcae` 的产物替换；若仅回滚测试基建而保留 bug 修复，按文件逐个 revert 即可。
- 门禁兼容：回滚后 `package.json` scripts 恢复原值即可，`npm run test` / `npm run build` / `npm run dist:win` 均不受影响。
- 用户数据：整改过程中对历史污染数据做了备份式清理——`%APPDATA%\Electron` 整目录改名保留（`Electron.e2e-pollution-backup-20261006`）；`%APPDATA%\file-pilot` 的 `settings.json` 与 `data.db` 均有 `.before-cleanup-20261006` 备份文件，可随时还原。

## 验证证据

执行环境：Windows 11（win32 10.0.26100 x64）、Node 20+、npm。worktree：`.worktrees/e2e-test-isolation`，分支 `feat/e2e-remediation-20261006`。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过（exit 0） | 终审复核通过 |
| `npm run lint` | 通过（exit 0） | 0 错误 0 警告（.tsx 由 tsc strict 覆盖，eslint 配置不含 tsx） |
| `npm run test` | 通过（exit 0） | unit + integration 全部通过 |
| `npm run test:qa` | 通过（exit 0） | 性能阈值用例含批式路径断言（`batchCalls >= 1`） |
| `npm run build` | 通过（exit 0） | 含渲染层 bug 修复后的重建 |
| `npm run dist:win` | 通过（exit 0） | 产出 `release/File Pilot Setup 0.1.0.exe`、`release/File-Pilot-0.1.0-Portable.exe`、`latest.yml`（16:06 构建，含 bug 修复） |
| `npm run test:e2e:core`（等价三件套） | 通过 | startup / workflow / rollback 全部通过 |
| `npx playwright test`（全量 e2e） | **23 passed / 0 failed / 2 skipped** | 2 个 skip 为 package-smoke 默认门控（单独运行通过） |
| `FILE_PILOT_RUN_PACKAGED_SMOKE=1 npx playwright test apps/desktop/tests/e2e/package-smoke.spec.ts` | 通过（2 passed） | **打包版应用同样不触碰真实数据**：运行前后 `%APPDATA%\file-pilot\settings\settings.json` mtime 逐字节一致 |
| 隔离证明 | 通过 | 多轮 e2e 运行前后 `%APPDATA%\Electron` 与 `%APPDATA%\file-pilot` 全目录路径+mtime+size 快照 diff 为零 |

执行过程说明：

- UI e2e（`ui-settings`）在编写过程中实证发现并定位了两个真实应用级 bug（设置 UI 改动从不落盘、消息提示被覆盖），修复后 3 个曾被标记 `test.fixme` 的用例全部转正通过。
- 终审 agent 对全量 diff 复查：real-main 环境变量时序、electron-launch 双启动分支、llm-stub 与真实模板判别、rollback 断言链、四处渲染层修复均经源码级验证；三个 P2（README spec 清单错引、CI 覆盖收窄、证据回填）已在提交前修复。
- 残余风险：llm-success 对请求次数的精确断言（1/2/4 次）对未来 `batchSize`/预置规则变化敏感，调整 LLM_CONFIG 时需同步；UI spec 依赖 Radix 组件可访问性选择器，CI 上已用 retries=1 + trace 缓解。
