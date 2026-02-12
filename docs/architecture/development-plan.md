# File-Pilot M1 开发规划（首轮）

## 目标

- 基于 `PLAN.md` 的约束建立可持续迭代的代码与测试基线。
- 先交付一个可验证功能闭环：日志导出（JSON + 默认匿名化 + 固定命名）。

## 分阶段计划

1. 工程基线
   - 建立 TypeScript strict、lint、test 脚本。
   - 创建 `apps/desktop/{shared,core,infra,tests}` 目录骨架。
2. 功能闭环（日志导出）
   - `shared/config`：导出配置常量集中化。
   - `core/usecases`：导出命名与匿名化规则。
   - `infra/fs`：JSON 落盘仓储。
3. 测试策略
   - Unit：命名规则、匿名化开关行为。
   - Integration：仓储写盘与 JSON 内容校验。
4. 交付门禁
   - 运行 `typecheck`、`lint`、`test`。
   - 完成 git 分阶段提交。

## 本轮已实现范围

- 日志导出基础能力：
  - 命名规则：`file-pilot-log-YYYYMMDD-HHMMSS.json`
  - 默认匿名化开启
  - 导出格式固定 JSON
  - schema_version 字段入导出内容

## 后续里程碑建议

1. 增加 IPC 契约层（main/preload/renderer）并接入日志导出按钮。
2. 接入下载目录默认路径与“导出后打开目录”交互。
3. 增加更新器骨架（beta/stable 通道、10 秒后自动检查、手动检查入口）。
