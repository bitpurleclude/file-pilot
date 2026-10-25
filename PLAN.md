# File-Pilot 规划书（v0.40）
日期：2026-01-30

目标与定位
- 面向个人用户的文件分类助手，Windows 优先，跨平台为可选扩展。
- 核心能力：拖入文件 → LLM 分析 → 给出建议路径 → 用户确认后放入。
- 一键分析为主，仅在不确定时进行简短追问；回答可应用整批。

已确认决策（2026-01-31）
- M1 技术栈：Electron + React。
- M1 LLM 接入：先实现通用可配置接口（Base URL + API Key），内置 OpenAI 预设与国内模型预设，其他提供商预留扩展位。
- M1 默认执行策略：仅 Dry-run；用户确认后手动选择 Move/Copy。
- 开发阶段安全白名单：首次运行强制引导选择（不预设默认目录）。
- M1 加入日志导出（会话日志/错误日志/执行记录），支持匿名化。
- 模型档位预设默认值：高质量。
- 命名规范化触发：仅在用户确认模板后执行。
- 命名规范化/重命名模板默认作用范围：仅目录名（不改文件名）。
- 日志导出匿名化默认：开启（用户可关闭）。
- 日志导出格式：仅 JSON。
- 日志导出默认保存位置：下载目录。
- 日志导出命名规则：file-pilot-log-YYYYMMDD-HHMMSS.json
- 日志导出后打开目录：弹窗询问

已确认决策（2026-02-12）
- 工程基线：vite + esbuild + TypeScript strict + npm。
- UI 方案：Tailwind + 自建组件。
- 自动更新：GitHub Releases，beta/stable 双通道。
- Beta 发布：手动打 tag 触发。
- 更新检查：启动后 10 秒自动检查 + 手动检查。
- 更新安装：下载完成后提示“重启安装”。
- Windows 签名：M1 先不签名。
- 本地数据库路径：userData/data/data.db。
- 日志保留策略：永久保留，手动清理。
- LLM 调用容错：超时 20 秒，失败重试 2 次。
- 凭据存储回退：Electron safeStorage 不可用时回退到机器绑定 AES-GCM 本地加密文件。

已确认决策（2026-02-12，P0 拍板）
- 置信度阈值：高 >= 0.85；中 0.60~0.84；低 < 0.60。
- 追问触发：仅低置信度（< 0.60）触发追问。
- 同名冲突默认策略：默认重命名（追加时间戳），支持手动改为覆盖/跳过。
- 回滚语义：会话内尽力全回滚，并明确标记不可回滚项。
- IPC 超时与取消：默认 30 秒超时，支持 AbortSignal 取消。
- 数据库主键：统一使用 UUID。
- 关键索引：sessions(created_at,status)、items(session_id,status)、logs(session_id,timestamp)。
- 任务状态机：pending -> analyzing -> planned -> applying -> done/failed/rolled_back。
- migration 规则：每次 schema 变更必须新增 migration，禁止改写历史 migration。
- 执行失败补偿：先停止后续任务，再记录失败点并对已执行项做反向补偿。

已确认决策（2026-02-12，P1/P2 拍板）
- 提示词版本：prompt_version 入库并可回放。
- 截断策略：头+尾+关键词段落混合截断。
- 超限解析：超限仅提取元数据与文件名特征。
- 并发默认值：hash=4、解析=3、LLM=2。
- 模型切换顺序：主模型失败 -> 备用模型 -> 本地规则兜底。
- 凭据回退加密：AES-GCM + 机器绑定 + 密钥版本号。
- 日志结构：固定 JSON Schema + schema_version。
- 成本熔断：达到日/月阈值后自动降级到规则模式。
- 更新失败处理：下载/校验失败重试 2 次，失败后回退当前版本。
- DB 不兼容处理：阻止启动并引导迁移/回退。
- 白名单引导：首次运行 3 步向导（选目录 -> 风险提示 -> 确认）。
- 性能验收：100 文件 Dry-run < 8 秒，执行 < 20 秒。
- Beta 升 Stable 门槛：连续 7 天无 P0/P1 且回滚成功率 > 99%。
- 发布门禁：typecheck/lint/unit/integration/e2e 全绿。
- 故障采集：本地崩溃报告 + 用户手动导出上传。
- 备份恢复：设置与规则每日增量备份，支持一键恢复。

已确认决策（2026-02-12，配置与文档治理）
- 配置集中化：业务代码禁止写死参数，统一收敛到 shared/config（可拆分多文件）。
- 配置分层：defaults -> user settings -> session overrides，加载时做 schema 校验。
- 文档标准：采用 docs/architecture、docs/conventions、docs/release、docs/adr 规范结构。
- 变更要求：每次代码修改必须同步至少一类文档（变更说明/接口文档/配置文档）。
- PR 门禁：源码变更但无文档变更时阻断，除非标注 docs-exempt 并说明理由。

已确认决策（2026-10-11，文档结构与治理层；2026-10-11 经所有者追认取代条目）
- 文档结构补充：在 docs/architecture|conventions|release|adr 之外新增 `docs/product`（vision、roadmap、governance-design、domain-research、decision-models、research-notes）。
- 产品定位升级为「个人文件层级治理层」，转向决策见 `docs/adr/0002-schema-first-governance-pivot.md`；该决策取代本文件 2026-02-12「M1 默认执行策略：仅 Dry-run」——Inbox 高置信文件自动入位（未确认标记 + 周报批量复核 + 可回滚）。追认依据与安全边界见该 ADR「对既有决策的取代」节。

已确认需求与约束
- LLM：云端模型可接受，默认 LLM 优先（本地规则仅辅助/校验）。
- 文件解析范围：txt / md / pdf / docx / xlsx。
- 语言：中文；无需离线模式。
- 目录结构：用途 → 项目 → 时间（按用途启用）。
- 时间层级用途：Media / Archives / Study。
- Study：采用方案 B（少量科目模板可关闭 + 用户自定义 + LLM 命名候选）。
- 多盘策略：自动建议 + 用户可覆盖；支持“高速盘临时放置 + 回迁提醒”。
- 自动回迁：不启用（仅提醒 + 一键回迁）。
- 软链接：允许管理员权限创建符号链接。
- 批量拖拽：软限制默认 100，可配置；混杂不可分析文件进入待处理会话。
- 待处理会话：允许用户批量填写说明并应用整批。
- “杂物/其它”：仅对低置信度文件再分析。
- LLM 解释：默认简短，可展开详细。
- LLM 成本控制：允许设置可选额度上限（每日/每月）。
- 归档回顾：默认每周摘要，频率可自定义；支持一键还原到原目录。
- 场景模板：启用；默认自动推荐 + 手动选择（推荐不强制）。
- 开发阶段安全限制：仅允许在指定目录内操作（防止影响全盘）。

用户主要流程
1) 拖拽文件 → 分析与 LLM → 建议位置与原因 → 批量确认/修改
2) 执行放入 → 记录日志 → 支持撤销（按会话选择性撤销）
3) 回迁提醒/归档回顾 → 一键回迁或还原

用途与目录结构
核心 6 类：
- Documents / Media / Code / Archives / Installers / Others
扩展类：
- Study / Work / Design / Finance / Research
目录层级：用途 → 项目 → 时间（按用途启用）

时间层级策略
- Media / Archives / Study 默认启用时间层级
- Study 以科目/课程为主，时间层级可选
- 示例：Media/漫展/2026/01

场景模板（默认集）
- 摄影：Media 优先、时间层级启用、SSD 临时放置 + 回迁提醒
- 学习：Study 优先、科目层级启用、Documents/Study 偏 SSD
- 工作：Work/Finance 优先、时间层级按需、固定目录
- 开发：Code 优先、时间层级关闭、项目路径固定
模板使用：
- 默认自动推荐（基于文件类型/来源/数量）
- 用户手动选择后仍显示推荐但不强制

多盘与热度策略
- 自动识别盘类型（SSD/HDD）、容量、剩余空间、是否系统盘
- 默认建议：SSD → Code/Documents；HDD → Media/Archives
- 高读写文件可“临时高速放置”，到期提醒回迁
- 用户可配置用途→盘位偏好与空间阈值

安装器处理（L1）
- 识别安装器类型与产品名 → 推荐安装路径 → 打开安装器由用户确认
- 未来可扩展 L2（参数预设安装路径）

工作区/缓存
- 默认关闭，仅对用户指定目录生效
- 可提示候选目录（需用户确认）
- 仅做大小阈值提醒，不自动清理

批量与会话策略
- 软限制：默认 100，超出提示分批
- 会话继承：默认把本次选择的用途/项目应用整批（可逐个覆盖）
- 不可分析文件进入“待处理会话”，集中询问信息
- 选择“杂物/其它”时，仅对低置信度文件再分析
- 支持“会话级撤销 + 勾选部分撤销”

功能清单（V1）
- 托盘入口 + 拖拽面板
- LLM 分类与解释（简短 + 可展开）
- 预览/试运行（Dry-run）
- 批量确认 + 会话级撤销（可选部分撤销）
- 规则学习（从用户修改中沉淀）
- 快速加速迁移 + 回迁提醒 + 一键回迁
- 命名规范化（空格/日期/非法字符；仅目录名；需用户确认模板后执行）
- 重命名模板（按场景/用途；用户确认后执行）
- 重复文件检测（hash/大小）
- 搜索入口（优先系统索引，可选 Everything）
- 轻量仪表盘（最近处理统计）
- 归档回顾（周报 + 一键还原）
- 安全模式：操作范围白名单（开发阶段默认开启）

技术实现路线
- 桌面端：Windows 先行；M1 采用 Electron + React，跨平台后续评估
- 工程与构建：vite + esbuild + TypeScript strict + npm
- UI 实现：Tailwind + 自建组件
- 分层：UI → 任务队列 → 分析器 → 分类器 → 路径规划器 → 执行器
- 内容抽取：仅上传必要摘要与关键词到 LLM
- 分类策略：LLM 主判定 + 本地规则校验 + 用户反馈学习
- 执行策略：移动/复制/链接；全程可回滚
- 搜索：优先使用系统索引；可选接入 Everything 加速
- 去重：hash 计算 + 组内合并建议
- 命名：规则化 + 模板化
- 更新策略：GitHub Releases + beta/stable 双通道；启动后 10 秒自动检查，支持手动检查
- 更新安装：下载后提示重启安装
- 安全范围：目录白名单/沙箱模式，限制可操作路径

发布与更新策略（v0.41）
- 更新源：GitHub Releases
- 通道：beta / stable 双通道
- beta 触发：手动打 tag
- 安装策略：下载后提示重启安装
- Windows 签名：M1 不签名（测试期）

存储与可靠性策略（v0.41）
- 本地数据库：userData/data/data.db（SQLite）
- 凭据存储：优先 Electron safeStorage；不可用时回退机器绑定 AES-GCM 本地加密
- LLM 容错：超时 20 秒，失败重试 2 次
- 日志保留：永久保留，用户手动清理

模块拆分
- UI：托盘、拖拽面板、建议列表、批量确认、回迁提醒、归档回顾、设置
- 分析器：元数据/摘要/类型识别
- 分类引擎：LLM + 规则学习
- 路径规划器：用途/项目/时间层级/盘位/热度策略
- 执行器：移动/复制/链接、回滚与日志
- 搜索与索引：系统索引/Everything 适配器
- 重复检测：hash 与建议合并
- 命名与模板：规范化/模板应用
- 提醒与报表：回迁提醒、周报、统计

API/模块接口（草案）
- Analyzer: analyze_files(), extract_summary()
- Classifier: classify(), explain()
- Planner: plan()
- Executor: execute(), rollback()
- Session: create_session(), apply_batch_decision()
- Dedup: find_duplicates()
- Search: query(), index_status()
- Naming: normalize(), apply_template()
- Reminder: schedule(), list()
- Settings: get_policy(), set_policy()

核心数据结构草案
- FileItem：path, name, ext, size, created_at, modified_at, hash, mime, drive, type_hint
- ContentSummary：text_snippet, keywords, entities, language
- Classification：purpose, project, time_bucket, confidence, reasons[]
- PlacementPlan：target_path, drive_rank[], link_mode, action(move/copy)
- Rule：matchers(ext/type/keywords/path), output(purpose/project/drive), priority
- TaskLog：task_id, inputs[], plan, result, rollback_info, timestamp
- SessionLog：session_id, items[], decisions[], rollback_options[]
- DuplicateGroup：hash, files[], suggested_action
- NamePolicy：template, normalize_rules[], date_format

里程碑（草案）
- M1：托盘入口 + 拖拽面板 + LLM 分类（简短解释） + Dry-run + 批量确认/会话级撤销 + 命名规范化（用户确认模板后执行）
- M2：LLM 分类 + 解释 + 模板推荐
- M3：批量会话 + 撤销 + 回迁提醒 + 命名规范 + 去重 + 搜索
- M4：安装器场景 L1 优化

搜索与去重/命名策略（v0.24）
- 搜索：Everything 可选集成（需开关；关闭或未安装则回退内置索引）
- 去重：计算 hash；hash 不同则忽略；hash 相同可合并并用软链接保留原路径
- 命名规范化：默认只对目录名生效
- 重命名模板：默认只对目录命名（不改文件名），且仅在用户确认模板后执行

默认策略结论（v0.25）
- 去重合并：保留版本由用户手动选择
- Everything 集成：默认关闭，未开启时不显示相关功能
- 安全模式：正式版保留为可选项
 - 安全模式默认值：开启
 - Everything 集成开关：放在“高级设置”

默认策略结论（补充 v0.28）
- 安全模式首次使用需引导说明（解释白名单目录与如何扩展）
- 首次运行强制引导选择白名单目录（不预设默认范围）
- 新手引导包含示例拖拽与示例模板选择
- 新手引导结束后自动创建示例规则

默认策略结论（补充 v0.30）
- 首次运行诊断：检测 Everything、盘位、权限并给出建议

迁移影响提示（v0.31）
- 提示策略可配置：仅高风险 / 总是提示 / 不提示
- 默认建议：仅高风险提示

默认策略结论（补充 v0.32）
- 迁移影响提示默认值：仅高风险

默认配置清单（v0.33）
- 工程基线：vite + esbuild + TypeScript strict + npm
- UI 方案：Tailwind + 自建组件
- 场景模板：默认自动推荐（可手动切换）
- 批量软限制：100
- 置信度阈值：高 >= 0.85；中 0.60~0.84；低 < 0.60
- 追问触发：仅低置信度（< 0.60）
- 提示词版本：prompt_version 入库
- 截断策略：头+尾+关键词段落混合截断
- 超限解析：仅元数据+文件名特征
- 并发默认值：hash=4、解析=3、LLM=2
- 配置集中化：业务参数统一读取 shared/config（禁止写死常量）
- 配置分层：defaults -> user settings -> session overrides
- LLM 解释：简短 + 可展开
- LLM 额度上限：关闭（可选开启）
- LLM 调用容错：超时 20 秒 + 重试 2 次
- LLM 主备切换：主模型 -> 备用模型 -> 本地规则
- 成本熔断：达到阈值后自动降级规则模式
- IPC 默认超时：30 秒（支持取消）
- 同名冲突默认策略：重命名（追加时间戳）
- 回滚语义：会话内尽力全回滚 + 不可回滚项标记
- 时间层级用途：Media / Archives / Study
- Study 组织：科目模板可关闭 + 用户自定义
- 回迁提醒：开启（手动一键回迁）
- 归档周报：开启（默认每周，可改频率）
- 自动更新：GitHub Releases（beta/stable），启动后 10 秒自动检查 + 手动检查
- 更新安装策略：下载后提示重启安装
- Beta 发布触发：手动 tag
- Windows 签名：M1 不签名
- 数据库路径：userData/data/data.db
- 数据库主键：UUID
- 关键索引：sessions(created_at,status)、items(session_id,status)、logs(session_id,timestamp)
- 任务状态机：pending -> analyzing -> planned -> applying -> done/failed/rolled_back
- migration 规则：每次 schema 变更新增 migration（不改历史）
- DB 不兼容处理：阻止启动并引导迁移/回退
- 首次白名单：3 步向导（选目录 -> 风险提示 -> 确认）
- 搜索：Everything 集成默认关闭（高级设置开关）
- 去重：默认仅提示，合并需手动选择保留版本
- 命名规范化触发：仅在用户确认模板后执行
- 命名规范化默认范围：仅目录名
- 重命名模板：仅对目录命名（用户确认后执行）
- 凭据存储：优先 Electron safeStorage；不可用时回退机器绑定 AES-GCM 本地加密
- 凭据回退加密：AES-GCM + 机器绑定 + 密钥版本号
- 日志结构：固定 JSON Schema + schema_version
- 日志导出匿名化：默认开启（可关闭）
- 日志导出默认范围：会话日志 + 错误日志 + 执行记录
- 日志导出格式：仅 JSON
- 日志导出默认保存位置：下载目录
- 日志导出命名规则：file-pilot-log-YYYYMMDD-HHMMSS.json
- 日志导出后打开目录：弹窗询问
- 日志保留策略：永久保留（手动清理）
- 崩溃采集：本地崩溃报告 + 手动导出上传
- 备份恢复：设置与规则每日增量备份 + 一键恢复
- 更新失败处理：重试 2 次后回退当前版本
- 性能验收目标（100 文件）：Dry-run < 8 秒，执行 < 20 秒
- Beta 升 Stable 门槛：连续 7 天无 P0/P1 且回滚成功率 > 99%
- 发布门禁：typecheck/lint/unit/integration/e2e 全绿
- 文档标准：docs/architecture + docs/conventions + docs/release + docs/adr
- 文档更新要求：每次代码修改至少同步一类文档
- 文档门禁：源码变更无文档更新默认阻断（docs-exempt 需说明）
- 迁移影响提示：仅高风险
- 安全模式：默认开启（目录白名单）

设置页结构（v0.33，草案）
1) 基础
   - 语言
   - 场景模板：自动推荐/手动
   - 批量软限制
2) 分类与目录
   - 用途列表与扩展类
   - 目录层级：用途/项目/时间
   - 时间层级启用用途
   - 命名规范化与模板
3) 盘位与热度
   - 用途→盘位映射
   - 临时高速放置与回迁提醒
4) LLM 与解释
   - 解释显示：简短/展开
   - 额度上限（可选）
5) 搜索与去重
   - Everything 集成（高级）
   - 去重提示与合并策略
6) 工作区/缓存
   - 指定目录
   - 阈值提醒
7) 安全与提示
   - 安全模式（目录白名单）
   - 迁移影响提示策略
8) 归档与回顾
   - 周报频率
   - 一键还原设置

设置页结构（v0.34，分层）
普通：
- 基础：语言、场景模板、批量软限制
- 分类与目录：用途列表、目录层级、时间层级用途、命名模板
- 盘位与热度：用途→盘位、回迁提醒
- 归档与回顾：周报频率、一键还原
高级：
- LLM 与解释：展开级别、额度上限
- 搜索与去重：Everything 集成、去重策略
- 工作区/缓存：指定目录、阈值提醒
- 安全与提示：安全模式白名单、迁移影响提示

设置导入/导出（v0.35）
- 支持导出/导入：规则、模板、盘位映射、提醒策略
- 格式：JSON（可读且便于版本管理）

待确认问题（v0.35）
已确认（v0.35）
- M1 需要“日志导出”功能（用于问题反馈/调试）。
日志导出（v0.36）
- 支持导出：会话日志、错误日志、执行记录
- 支持匿名化：可选去除路径/文件名（默认开启）
- 默认导出范围：会话日志 + 错误日志 + 执行记录（默认匿名化）
- 导出格式：仅 JSON
- 默认保存位置：下载目录
- 默认命名规则：file-pilot-log-YYYYMMDD-HHMMSS.json
- 默认导出后打开目录：弹窗询问

最小化权限模式（v0.37）
- 可选启用：不请求管理员权限
- 限制：无法创建符号链接/访问受限目录
- 替代方案：回退为快捷方式或仅复制

模型切换（v0.38）
- 支持多 LLM 提供商（可配置 API Key）
- 允许为不同场景模板设置不同模型
- 支持失败回退（主模型不可用时切备用）
 - M1 实施顺序：通用可配置接口（Base URL + API Key）→ OpenAI 预设 → 国内模型预设 → 预留扩展位
- 调用可靠性：超时 20 秒，失败重试 2 次

本地模型（v0.39）
- 作为可选项提供（用于离线/隐私）
- 能力范围：只做分类建议与命名，不做复杂解释
- 触发条件：用户手动选择或云端不可用

模型档位预设（v0.40）
- 提供“省钱 / 平衡 / 高质量”三档
- 对应预设模型与参数组合
- 高级设置可手动覆盖
 - 默认档位：高质量

工程与代码规范（v0.42）
- 架构分层：Renderer(UI) → IPC Client → Preload → Main Handler → UseCase → Domain → Infra Adapter。
- 依赖方向：UI 仅依赖 application/shared；domain 禁止依赖 infra，必须单向流动。
- 进程职责：渲染进程禁止直接访问 fs/path/sqlite/safeStorage，所有系统能力统一经 IPC。
- IPC 原则：白名单通道 + zod schema 校验 + 统一错误码返回格式。
- 业务约束：Main Handler 只做参数校验与调度，业务编排必须在 UseCase 层。

文件夹规范（v0.42）
- 推荐目录（M1）：
```text
file-pilot/
  apps/desktop/
    electron/
      main/        # app 生命周期、窗口、托盘、IPC 注册、更新器
      preload/     # contextBridge 白名单 API
      updater/     # GitHub Releases 双通道更新逻辑
    src/
      app/         # 路由与全局 Provider
      pages/       # 页面级容器
      features/    # 功能域 UI（session/planner/executor/settings）
      components/  # 可复用组件
      styles/      # Tailwind 入口与主题变量
    core/          # UseCase + Domain（纯业务规则）
    infra/         # SQLite/LLM/safeStorage/文件系统/日志适配器
    shared/        # 类型、错误码、常量、schema、IPC contract
    tests/         # unit/integration/e2e
  docs/
    architecture/
    conventions/
    release/
```
- 单文件建议：普通文件不超过 300 行；页面容器不超过 400 行。

函数调用规范（v0.42）
- 单一职责：一个函数只承担一种核心职责（校验/转换/持久化/编排需拆分）。
- 长度与复杂度：单函数不超过 60 行，圈复杂度不超过 10。
- 参数约束：参数超过 4 个必须改为对象参数并进行 schema 校验。
- 调用深度：业务调用链深度不超过 4 层，超出必须重构。
- 命名规范：命令函数使用动词（create/update/delete），查询函数使用 get/list/find。
- 副作用隔离：Domain 优先纯函数；副作用仅允许在 UseCase/Infra 层发生。
- 布尔参数治理：禁止语义不明的多个布尔位参数，改为枚举或选项对象。

类型与静态检查规范（v0.42）
- TypeScript：strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes 必须开启。
- 禁止 any：默认开启 no-explicit-any，确需例外需注释说明原因。
- Promise 约束：开启 no-floating-promises、no-misused-promises。
- 导入规范：统一 type-only import，禁止循环依赖（import/no-cycle）。
- 边界约束：禁止跨层越权 import（UI 不得直接 import infra）。

ESLint 与格式化门禁（v0.42）
- 建议强制规则：max-lines(300)、max-lines-per-function(60)、complexity(10)、max-params(4)。
- 质量门禁：提交前必须通过 typecheck + lint + unit。
- CI 门禁：PR 合并前必须通过 typecheck + lint + unit + integration。

错误处理与可观测性规范（v0.42）
- 统一错误模型：AppError(code, message, details, cause, traceId, sessionId)。
- 错误分级：USER_（可提示）、SYSTEM_（可重试）、FATAL_（需人工介入）。
- 返回协议：IPC 统一 { ok: true, data } / { ok: false, error }。
- LLM 容错：20 秒超时 + 2 次重试 + 指数退避，仅网关层允许重试。
- 执行审计：所有执行动作记录计划、结果、回滚信息，支持追溯。

测试规范（v0.42）
- Unit：覆盖路径规划、命名规范化、规则匹配、冲突决策等核心纯函数。
- Integration：覆盖 IPC 合约、SQLite 读写、凭据回退链路、LLM 网关容错。
- E2E：覆盖拖拽 → Dry-run → 执行 → 撤销主流程。
- 覆盖率目标：M1 的 core/usecase 模块行覆盖率不低于 70%。
- 测试数据：使用临时目录沙箱，禁止污染真实用户目录。

性能与并发规范（v0.42）
- 队列化：文件解析、hash 计算、LLM 调用分别设置并发上限。
- 可取消：长任务需支持 AbortSignal，中断会话时及时回收任务。
- 分批处理：批量任务按分片执行并落盘 checkpoint，降低中断风险。
- 主进程负载：CPU 重任务优先 worker 线程，避免阻塞 UI/IPC。

安全与隐私规范（v0.42）
- 路径安全：先 canonicalize 再做白名单校验，防目录穿越。
- 凭据安全：优先 Electron safeStorage，失败回退机器绑定 AES-GCM 本地加密（enc:v1 前缀）。
- 日志默认：匿名化开启，导出默认 JSON，保存下载目录，命名规则固定。
- 数据保留：日志永久保留但需提供体积阈值告警与手动清理入口。

协作与发布规范（v0.42）
- 分支命名：feat/*、fix/*、chore/*；主分支保持可发布状态。
- 提交规范：feat/fix/refactor/docs/chore/test 前缀。
- Beta 发布：手动 tag 触发 prerelease（beta 通道）。
- 正式发布：通过人工验收后发布 stable tag/release。
- 更新通道：beta 客户端仅跟踪 beta，stable 客户端仅跟踪 stable。

开工前拍板细则（v0.43）
- 置信度分层：>= 0.85 直接建议；0.60~0.84 建议并提示确认；< 0.60 触发追问。
- 追问策略：追问仅面向低置信度项，且支持“本次答案应用整批”。
- 冲突处理：目标同名默认重命名（时间戳），允许用户改为覆盖或跳过。
- 回滚策略：会话级回滚优先；不可回滚项必须在结果页显式列出原因。
- IPC 合约：统一 30 秒超时与取消协议，超时返回标准错误码。
- 主键与索引：全局 UUID；关键索引覆盖会话查询、任务列表和日志追溯。
- 状态机：pending -> analyzing -> planned -> applying -> done/failed/rolled_back。
- 迁移约束：采用增量 migration；历史 migration 禁止修改，仅允许追加。
- 失败补偿：失败即停止后续任务，执行反向补偿并输出补偿报告。

开发中拍板细则（v0.44）
- 提示词版本管理：所有分类请求记录 prompt_version，支持问题回放与灰度比对。
- 文本截断策略：头段+尾段+关键词命中段落混合抽样，优先保留语义密度高片段。
- 大文件降级：超过解析体积上限时，仅提取元数据与文件名特征，不做全文抽取。
- 并发策略：hash=4、解析=3、LLM=2，避免 UI 卡顿与主进程阻塞。
- 模型容灾链路：主模型失败 -> 备用模型 -> 本地规则兜底。
- 凭据回退加密：采用 AES-GCM，含机器绑定因子与密钥版本号字段。
- 日志协议：固定 JSON Schema 与 schema_version，变更需版本升级与兼容说明。
- 成本熔断：达到日/月阈值后自动降级规则模式，并在 UI 显示降级状态。

发布前验收细则（v0.45）
- 更新异常流：下载/校验失败最多重试 2 次，失败后保持当前版本并给出可操作提示。
- 版本兼容：客户端与 DB schema 不兼容时阻止启动，提供迁移或回退路径。
- 白名单引导：首次运行采用 3 步向导（选目录 -> 风险提示 -> 确认）。
- 性能验收：100 文件场景 Dry-run < 8 秒，执行 < 20 秒。
- Beta 转 Stable 门槛：连续 7 天无 P0/P1 且回滚成功率 > 99%。
- 发布门禁：typecheck、lint、unit、integration、e2e 必须全部通过。
- 故障采集：默认本地崩溃报告，用户手动导出并上传。
- 备份恢复：设置与规则每日增量备份，支持一键恢复。

配置与文档治理规范（v0.46）
- 参数治理：阈值、超时、重试、并发、路径、开关、文案等禁止在业务代码中写死。
- 配置组织：按领域拆分为 analyzer.config、llm.config、executor.config、updater.config、ui.config。
- 配置加载顺序：defaults -> user settings -> session overrides，加载后统一 schema 校验。
- 配置可追溯：每次配置变更记录来源、时间、版本与生效范围。
- 文档结构：
```text
/docs
  /architecture   # 架构与模块边界
  /conventions    # 代码规范、命名规范、错误码规范
  /release        # 发布流程、回滚流程、验收清单
  /adr            # 关键决策记录（Architecture Decision Records）
```
- 文档同步要求：每次功能开发、修复、重构必须更新对应文档条目。
- 文档最小更新集：至少包含“变更内容、影响范围、配置变更、回滚说明、测试证据”。
- PR 检查项：新增 mandatory checklist，必须勾选“代码变更已同步文档”。
- CI 门禁：源码文件变更且 docs 无变化时默认失败；如 docs-exempt 需填写理由。
- 例外策略：仅注释/格式化等无行为变更可申请 docs-exempt。

待确认问题（v0.40）
已确认（v0.40）
- 预设档位默认值：高质量。
