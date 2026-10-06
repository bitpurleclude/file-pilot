# File-Pilot

File-Pilot 是一个基于 Electron + React + TypeScript 的桌面文件整理工具。  
当前代码实现已覆盖 M2/M3 关键能力：

- 规则优先 + LLM 主备 + 本地兜底的分类管线
- 低置信度追问（follow-up）
- 手工修正沉淀为规则（rule learning）
- SQLite 持久化与增量迁移
- 完整测试门禁（unit / integration / e2e / QA）

## 项目状态

- 版本：`0.1.0`
- 包管理器：`npm`
- 打包目标：Windows NSIS + Portable（`electron-builder`）
- 桌面架构：`Renderer -> IPC Client -> Preload -> Main Handler -> UseCase -> Infra`

## 技术栈

- Electron `33.x`
- React `18`
- TypeScript（strict）
- Vite + esbuild
- Vitest + Playwright
- Zod
- better-sqlite3

## 目录结构

- `apps/desktop/src`：Renderer 页面与组件
- `apps/desktop/electron`：主进程与 preload
- `apps/desktop/core`：用例层
- `apps/desktop/infra`：存储、日志、LLM、更新器等基础设施
- `apps/desktop/shared`：类型、配置、错误、IPC 协议
- `apps/desktop/tests`：unit / integration / e2e / qa
- `docs/`：架构、规范、发布与验收文档

## 快速开始

### 环境要求

- Node.js `20+`
- npm `10+`
- Windows（打包目标为 NSIS）

### 安装依赖

```bash
npm ci
```

### 构建

```bash
npm run build
```

### 本地运行（Electron）

```bash
npx electron .
```

### 仅运行前端（Renderer）

```bash
npm run dev
```

## 使用说明（界面操作流程）

### 1) 首次启动：设置白名单或只读模式

1. 启动应用后会检测白名单目录。
2. 若为空，先在输入框填写允许操作的目录（`;` 分隔多个路径），点击 `Save Whitelist`。
3. 如果暂时不希望执行真实文件操作，可选择只读模式（Read-only）。

### 2) 导入文件并分析

1. 将文件拖入 `Drop files here` 区域。
2. 点击 `Analyze and Plan`。
3. 系统会返回分类建议与目标路径计划（默认按 dry-run 流程使用）。

### 3) 处理低置信度结果（Follow-up）

1. 当出现 `needsFollowUp` 时，输入追问答案（通常是项目名或业务上下文）。
2. 点击 `Submit Follow-up`。
3. 前端会同步刷新分析数据，确认 `needsFollowUp` 是否已清空。

### 4) 手工修正并沉淀规则

1. 选择修正 `Purpose`、`Project`。
2. 勾选 `Save as rule`（可选）。
3. 点击 `Save Correction`。
4. 若保存为规则，规则会加入规则列表，可在规则面板启停。

### 5) 规则管理

1. 点击 `Refresh Rules` 拉取规则列表。
2. 对单条规则执行启用/禁用。
3. 需要调整优先级等字段时，可通过 `updateRule` 接口扩展管理 UI。

### 6) 执行与回滚

1. 先点击 `Dry-run` 验证计划。
2. 确认后再执行真实操作（当前接口支持 `move/copy`）。
3. 若执行后需要撤销，可点击 `Rollback`。

### 7) 日志与更新

1. `Export Logs` 导出日志（支持匿名化）。
2. `Refresh Log Status` 查看日志体积告警。
3. `Check/Download/Install Update` 走内置更新流程。

## 常用命令

```bash
# 质量检查
npm run typecheck
npm run lint
npm run test
npm run test:e2e:core
npm run test:e2e
npm run test:qa

# 构建与打包
npm run build
npm run dist:win
```

补充：

- e2e 核心门禁：`npm run test:e2e:core` 只跑 startup/workflow/rollback 三个核心场景，适合本地快速验证（打包/e2e 相关改动时必须，纯文档改动可跳过）
- 查看 e2e 用例：`npm run test:e2e:list`
- QA 性能专项：`npm run test:qa:perf`
- QA 可靠性专项：`npm run test:qa:reliability`
- 打包：`npm run dist:win` 现在同时产出 NSIS 安装包与便携版（Portable）两种产物

## 数据与配置位置

运行时使用 `app.getPath("userData")` 目录，核心数据如下：

- `data/data.db`：SQLite 主库
- `settings/settings.json`：设置
- `logs/events.jsonl`：结构化日志
- `updates/`：更新相关文件

## IPC 接口（摘要）

统一返回协议：

- 成功：`{ ok: true, data }`
- 失败：`{ ok: false, error: { code, message } }`

核心通道：

- 会话：`fp:analyze` / `fp:apply` / `fp:rollback`
- 追问修正：`fp:submit-followup` / `fp:save-corrections`
- 规则管理：`fp:list-rules` / `fp:update-rule`
- 系统：`fp:get-settings` / `fp:save-whitelist` / `fp:get-log-status` / `fp:clear-logs`
- 日志：`fp:export-logs`
- 更新：`fp:check-updates` / `fp:download-update` / `fp:install-update`

协议定义见：`apps/desktop/shared/ipc/contracts.ts`

## 测试策略

- Unit：纯逻辑（规则、阈值、模板渲染、迁移 runner 等）
- Integration：仓储与 handler 合同
- E2E：启动、流程、错误路径、规则学习、迁移、回滚、隔离、LLM 成功链路、打包 smoke
- QA：性能阈值与回滚可靠性阈值

E2E 运行时保障：

- 测试隔离：Playwright Electron 启动 helper 会自动注入 `FILE_PILOT_USER_DATA_DIR` / `FILE_PILOT_WORKSPACE_ROOT` 环境变量并指向临时目录，测试永不触碰 `%APPDATA%` 下真实 userData 与真实文件目录。
- LLM stub：e2e 通过 `helpers/llm-stub.ts` 注入确定性 LLM 分类结果，不依赖外部 LLM 服务，保证场景可离线、可复现。

参考文档：

- `apps/desktop/tests/e2e/README.md`
- `docs/architecture/e2e-test-plan.md`
- `docs/release/qa-acceptance.md`

## 打包发布

```bash
npm run dist:win
```

`npm run dist:win` 现在同时产出安装版（NSIS）与便携版（Portable）两种包。

产物默认在：

- `release/File Pilot Setup 0.1.0.exe`（NSIS 安装包）
- `release/File-Pilot-0.1.0-Portable.exe`（便携版，单文件免安装，双击直接运行）
- `release/win-unpacked/File Pilot.exe`

便携版说明：

- 无需安装，双击 `File-Pilot-0.1.0-Portable.exe` 即可直接运行。
- 便携版仅指程序本身免安装；运行时数据（数据库 / 设置 / 日志）仍保存在用户目录 `%APPDATA%\File Pilot`（Electron `userData`），不会随程序文件携带。
- 因此换机器运行便携版不会自动带数据；如需迁移，需手动拷贝 `%APPDATA%\File Pilot` 下的数据目录。

当前阶段签名策略：

- `forceCodeSigning: false`
- `win.signAndEditExecutable: false`

## 常见问题

### 1) better-sqlite3 ABI 不匹配

Node 侧测试前执行：

```bash
npm run native:rebuild:node
```

Electron/e2e/打包前执行：

```bash
npm run native:rebuild:electron
```

### 2) packaged smoke 默认不执行

```bash
$env:FILE_PILOT_RUN_PACKAGED_SMOKE="1"
npx playwright test apps/desktop/tests/e2e/package-smoke.spec.ts
```

### 3) analyze 提示模板缺失

- 先执行 `npm run build`
- 确认 `dist/electron/templates/classify.v1.njk` 存在
- 构建脚本会通过 `scripts/copy-sqlite-migrations.mjs` 复制模板与迁移文件

## 相关文档

- 规划：`PLAN.md`
- 实现约定：`docs/conventions/m1-implementation.md`
- 架构：`docs/architecture/`
- 发布：`docs/release/`
