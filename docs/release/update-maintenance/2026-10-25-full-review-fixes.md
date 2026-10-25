# 更新维护记录：2026-10-25 全盘审查修复

## 变更标识

- 分支：`fix/full-review-20261025`（基于 `transition-provider-only-wip` @ `0238c6e`）
- worktree：`.worktrees/review-fixes-20261025`
- 类型：安全加固 + 缺陷修复 + 治理修复（无对外行为删除；一处契约收紧见下）
- 触发：用户对 `0238c6e` 的全盘代码审查报告（2026-10-25），修复其中全部可执行项

## 发布信息

- 版本基线：`0.1.0`（package.json 未变更）
- 通道：beta（`UPDATER_CONFIG.channel`，与现状一致）
- 发布方式：合并后走既有 `release-publish.yml`（push beta/master 触发）；本变更不单独发布

## 修复清单（对应审查报告编号）

### P0
- `installUpdate` 渲染层任意可执行路径执行 → 安装包路径改由主进程在 `downloadUpdate` 后跟踪（`updater-handlers.ts`），IPC 契约不再接受 `installerPath`；下载路径必须位于 `userData/updates` 内。

### P1
- 执行器批量无逐项容错 → `execute-and-rollback.ts` 重写：逐项 try/catch（失败不中断批次、已移动文件保持可回滚记录）、目标冲突按 `conflictPolicy` 落实（rename 后缀/skip/overwrite）、跨盘 EXDEV 降级 copy+delete、回滚源路径被占用时落 `-N` 后缀并标记 `rolled-back-conflict`；`apply` 部分失败时会话状态置 `failed` 并记录 `SESSION_APPLY_PARTIAL_FAILURE`。
- `project` 路径注入（LLM 输出/追问/纠错/规则）→ 契约层 `projectSegmentSchema`（拒路径分隔符、Windows 非法字符、`.`/`..`）；LLM 响应 schema 同步收紧；`plan-placement.ts` 增加 `sanitizeProjectSegment` 纵深防御。
- API key 明文落盘 → 新增 `provider-key-codec`（safeStorage 优先，机器绑定 AES-GCM 回退，`enc:v1:` 前缀）；settings.json 不再存明文；历史明文下次保存自动加密；`getSettings` 仅返回 `__STORED__` 哨兵，保存时哨兵还原真实 key；删除两份零引用死代码模块（credential-storage.ts / credential-store.ts）。
- 白名单无边界前缀匹配 → `whitelist.ts` 按分隔符边界比较 + Windows 大小写不敏感。
- 工具链误入 `.worktrees/` → eslint 全局 ignores（顺带覆盖 .tsx）+ vitest `test.exclude`；主工作区 `npm run lint`/`npm run test` 恢复可用。
- 更新下载完整性 → 安装包仅允许 GitHub 下载域（https）+ 按 `downloadRetryCount` 重试 + 流式写盘（arrayBuffer 回退）。签名（Authenticode + dist 配置）仍关闭，属基础设施决策，未在本变更内解决。

### P2
- `saveWhitelist` 静默关闭只读模式 → 仅首次配置白名单（空→非空，onboarding）时解锁。
- LLM 错误全静默 → 网关返回类型化失败（HTTP 状态分类、401/403/404 不重试不换备模型）；降级分类的 `reasons` 记录 `llm-failed:<code>`。
- `protocol: "custom"` 半成品 → 移除；存量值归一化为 `openai`；UI 选项同步移除。
- 主进程加固：显式 `contextIsolation/sandbox/webSecurity`、拦截 `will-navigate`、拒绝 `setWindowOpenHandler`、单实例锁、渲染层 CSP meta、启动更新检查 try/catch。
- 测试 EBUSY（Windows sqlite 句柄）→ 暴露 `closeAllSqliteDatabases` 于测试 afterEach；`busy_timeout=5000`。
- `baseUrl` 保存校验 `z.string().url()`；`testProviderConnection` 复用 provider-adapter 并支持哨兵 key 服务端解析。

### P3
- `app.tsx:376` TS2379（exactOptionalPropertyTypes）修复。
- LLM 返回 markdown 围栏 JSON 剥离后解析。
- `analyzeFiles` 逐文件容错并给出失败文件名清单（AppError `FILE_ANALYZE_FAILED`）。

### 治理（文档）
- 4 份滞留 release 文档提交：`qa-acceptance.md`（修正 pre-release 门禁措辞为"发布后运行"）、`m1-checklist.md` → 重命名 `release-checklist.md`（标题与状态失实修正：无证据项改为未勾选）、`pending-confirmations.md` 原样提交；M1 旧稿 `e2e-test-plan.md` 未提交（与 docs/architecture 同名文档重复，待人工裁决删除或归档）。
- PLAN.md 基线腐化修正：pnpm→npm、electron-vite→vite+esbuild、keytar→safeStorage、数据库路径→`userData/data/data.db`。
- README M2/M3 完成度声明改为如实描述（M2 + 规则学习子集）。

## 契约变更（需注意）

- `fp:install-update` 入参从 `{ installerPath }` 变为 `{}`（破坏性，仅影响自研渲染层，已同步）。
- `fp:submit-followup.answer` / `fp:save-corrections.project` / `fp:update-rule.project` 增加字符约束（拒绝路径分隔符等）。
- `providerConfigSchema.baseUrl` 要求合法 URL；`protocol` 仅允许 `openai`（存量 custom 自动归一化）。
- `getSettings` 返回的 `apiKey` 为 `__STORED__` 哨兵。

## 文档变更清单

- 修改：`README.md`、`PLAN.md`、`docs/release/qa-acceptance.md`
- 新增：`docs/release/release-checklist.md`、`docs/release/pending-confirmations.md`、本记录
- 未提交：`docs/release/e2e-test-plan.md`（主工作区仍为未跟踪状态，重复旧稿）

## 回滚说明

1. 代码回滚：`git revert <本提交 SHA>`（单提交，无数据库 schema 变更、无 settings 格式不兼容——加密 key 与明文 key 可共存读取：无前缀即明文透传）。
2. 设置数据回滚：若回滚到旧版本应用，已加密的 `enc:v1:` key 对旧代码表现为乱串 key——旧代码会将其原样发送给供应商导致 401。如需彻底回退，手工编辑 `userData/settings/settings.json` 将 `apiKey` 的 `enc:v1:...` 值删去并重新在 UI 录入明文 key（旧代码下次保存会写回明文）。
3. 更新包回滚：`userData/updates/` 下的安装包可整目录删除，无状态残留。
4. 契约回滚注意：`fp:install-update` 入参形状变更随代码一同回滚，无独立数据迁移。

## 验证证据（2026-10-25，Windows，worktree `.worktrees/review-fixes-20261025`）

- `npx tsc --noEmit` → 0 错误（修复前 1 个：app.tsx:376 TS2379）
- `npx eslint .` → 0 错误 0 警告（修复前 1185 错误，全部来自 `.worktrees/` 误扫）
- `npx vitest run --root . apps/desktop/tests/unit apps/desktop/tests/integration` → **27 文件 84 测试全部通过**（修复前 49/52，3 个 EBUSY 失败）
- `npm run build` → 成功（renderer + electron bundles + 迁移/模板复制）
- 未执行（如实记录）：`npm run test:e2e`（需 electron 原生重建）、`npm run test:qa`、`npm run dist:win`

## 已知剩余风险（明确不在本次修复范围）

以下项经评估后**刻意保留**或**超出代码修复权限**，按影响排序：

1. **安装包无签名与发布侧校验和**（P1 残余）：本修复仅锁定 GitHub https 下载域；完整供应链验证需要发布流程为每个 release 附 SHA256 校验和文件 + 采购代码签名证书并打开 `signAndEditExecutable`。属基础设施与流程决策。
2. **发布通道空转**：客户端默认 `channel: "beta"`，但 beta 分支从未创建、master 落后主线——更新检查将恒为 `channel_no_release`。建分支/合分支/推进 master 属发布操作，需维护者决策（当前存在 9 个未收敛的 worktree 分支）。
3. **日志脱敏仍非完整 PII 方案**：已增强为"路径整串脱敏 + email/常见 API key 令牌子串脱敏"；不含分隔符的用户名、自定义格式标识符仍会原样导出。完整方案需要产品定义敏感数据边界（正则/NER 均不够彻底）。
4. **置信度语义注水**（产品决策保留）：followup 将置信度拉至 askThreshold、手工纠错拉至 0.95，决策记录中的置信度是合成值。改动会改变规则学习数据口径，需产品拍板。
5. **`matched-rule:<id>` 字符串协议**：历史决策记录已固化该格式，结构化替换需数据迁移，暂保留。
6. **`testProviderConnection` 允许 http/内网地址**：本地模型（Ollama 等）是合法用例；桌面威胁模型下不做 SSRF 级限制，接受此风险。
7. **迁移 runner 无已应用迁移校验和**：被篡改的已应用 .sql 文件不会被发现（新文件会正常应用）。
8. **settings 并发加载双写**：load 迁移路径可能双写 settings.json，内容幂等，良性。
9. **白名单内符号链接跟随**：stat/readFile 跟随符号链接，白名单目录内的链接可指向外部；影响读取面，不扩大写入面。
10. **历史提交的维护交付物缺口**（5 个提交）无法事后诚实补齐，只能自本记录起执行。

## 追加修复（同日第二轮）

- `export-logs.ts` 匿名化增强（见第 3 条边界说明）+ 2 个测试
- `reportClientError` 渲染层文本压控制字符 + 限长 2000（日志注入防护）
- 移除 `UPDATER_CONFIG.installPrompt` 死配置
- 渲染层完整审查（此前缺口）及对应修复
- 打包/e2e/QA 验证结果（见下方追加验证证据）
