# File-Pilot

File-Pilot 是一个**常驻系统托盘**的桌面文件整理工具：点击托盘图标弹出紧凑悬浮窗完成主要动作，设置页在独立窗口中打开。

当前代码实现已覆盖 M2/M3 关键能力与治理层阶段①，并完成托盘化 UI 重构：

- 托盘常驻 + 无边框悬浮窗（按内容自适应高度，点击外部自动收起）
- 独立设置窗口（侧边栏导航、自动保存状态、规则/更新/日志集中管理）
- 规则优先 + LLM 主备 + 本地兜底的分类管线
- 低置信度追问（follow-up）
- 手工修正沉淀为规则（rule learning）
- 治理层登记册：领域/项目两级坐标、空号认领、三级建域查重、`NEW:` 建域提案
- 坐标认领管线：LLM 输出枚举校验 + 双轨（coordinated / legacy）落位 + 追问/修正坐标保持
- 本地决策模型影子模式（默认关闭，仅记录对齐，不下盘）
- SQLite 持久化与增量迁移
- 完整测试门禁（unit / integration / e2e / QA）

## 项目状态

- 版本：`0.1.0`
- 包管理器：`npm`
- 打包目标：Windows NSIS + Portable（`electron-builder`），带应用图标与托盘图标
- 窗口形态：系统托盘 → 悬浮窗 → 独立设置窗口
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

## 使用说明（托盘 → 悬浮窗 → 设置）

### 1) 启动与托盘

1. 启动应用后不会弹出大窗口；系统托盘出现 File-Pilot 图标。
2. 左键托盘图标：显示/隐藏悬浮窗；右键：打开、设置、打开工作区、退出。
3. 首次启动（白名单为空）会自动弹出悬浮窗，展示三步白名单向导。
4. 悬浮窗点击外部或按 `Esc` 收起；再次点击托盘恢复。

### 2) 导入文件

1. 把文件拖进悬浮窗的 dropzone，或点击 dropzone 打开文件选择器。
2. 悬浮窗只做接收与预览，文件路径仍通过主进程校验白名单。
3. 已选文件会显示为紧凑的 chip；超过 3 个显示数量。

### 3) 分析、预演与执行

1. `分析并规划` 生成落位计划（规则 → LLM → 兜底）。
2. 计划卡展示前 4 个文件、目标坐标/路径与置信度。
3. `预演` 只验证不落盘；`执行计划` 需要第二次点击“确认移动”才真正移动文件。
4. `回滚` 撤销当前会话已执行的操作。

### 4) 追问与修正

1. 低置信度时悬浮窗内直接出现追问输入；提交后刷新计划。
2. 修正面板可调整首个文件的 Purpose/Project，并可选“保存为规则”。
3. 追问/修正命中登记册坐标时保持 coordinated 落位；`NEW:` 仍作为建域提案。

### 5) 设置窗口

点击悬浮窗右上角齿轮打开独立设置窗口：

- **通用**：语言、只读模式
- **分类**：置信度阈值、规则学习
- **规则**：查看/启停学习到的规则
- **登记册**：领域/项目、建域查重、`NEW:` 提案
- **LLM 配置**：供应商、模型策略、连接测试
- **更新**：通道、检查、下载、安装（安装包带 SHA-512 校验）
- **日志**：体积状态、导出、清理
- **高级**：白名单目录（通过 `saveWhitelist` 持久化）

设置通过 600ms 防抖自动保存，右上角显示“等待修改/保存中/已保存/失败重试”。关闭设置窗口会回到悬浮窗，并刷新只读/语言/白名单状态。

### 6) 退出

托盘右键 → `Quit File-Pilot`，或安装更新后自动退出。关闭悬浮窗/设置窗口不会退出应用。

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
- 登记册：`fp:registry-list` / `fp:registry-create-area` / `fp:registry-create-project` / `fp:registry-archive` / `fp:registry-check-duplicate` / `fp:registry-proposals`
- 窗口/外壳：`fp:open-settings` / `fp:hide-popover` / `fp:close-settings` / `fp:open-workspace` / `fp:pick-files` / `fp:resize-popover`
- 主进程 → 渲染进程事件：`fp:popover-shown`（设置窗口关闭或托盘重新展开时刷新状态）

协议定义见：`apps/desktop/shared/ipc/contracts.ts`

## 测试策略

- Unit：纯逻辑（规则、阈值、模板渲染、迁移 runner 等）
- Integration：仓储与 handler 合同
- E2E：启动、流程、错误路径、规则学习、迁移、回滚、隔离、LLM 成功链路、打包 smoke
- QA：性能阈值与回滚可靠性阈值

E2E 运行时保障：

- 测试隔离：Playwright Electron 启动 helper 会自动注入 `FILE_PILOT_USER_DATA_DIR` / `FILE_PILOT_WORKSPACE_ROOT` 环境变量并指向临时目录，测试永不触碰 `%APPDATA%` 下真实 userData 与真实文件目录。
- 隐藏窗口：helper 默认注入 `FILE_PILOT_E2E_HIDE_WINDOW=1`，悬浮窗与设置窗均以 `show:false` 创建，Playwright 仍通过 CDP 驱动；运行 e2e 不会在桌面反复闪窗。
- 双窗口：`openSettingsWindow(app, popoverPage)` 等待新的设置 BrowserWindow；`closeSettingsWindow(settingsPage)` 关闭并返回悬浮窗。
- LLM stub：e2e 通过 `helpers/llm-stub.ts` 注入确定性 LLM 分类结果，不依赖外部 LLM 服务，保证场景可离线、可复现。

参考文档：

- `apps/desktop/tests/e2e/README.md`
- `docs/architecture/e2e-test-plan.md`
- `docs/release/qa-acceptance.md`

## 打包发布

```bash
npm run dist:win
```

`npm run dist:win` 现在同时产出安装版（NSIS）与便携版（Portable）两种包。安装器/窗口图标来自 `resources/icon.ico`；托盘图标来自 `apps/desktop/electron/assets/tray-icon.png`，构建时复制到 `dist/electron/assets`。`scripts/generate-icons.ps1` 可从同一张绘制源重新生成三者。

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
- 产品：`docs/product/`（愿景 `vision.md`、领域研究 `domain-research.md`、治理层设计 `governance-design.md`、决策模型选型 `decision-models.md`、研究笔记 `research-notes.md`、路线图 `roadmap.md`）
- 实现约定：`docs/conventions/m1-implementation.md`
- 架构：`docs/architecture/`
- 决策记录：`docs/adr/`
- 发布：`docs/release/`
- 交接/待办：`docs/plan/tray-ui-followups.md`
