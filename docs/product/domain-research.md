# 领域研究与竞品版图

版本：v1.0（2026-10-10）
用途：为 `vision.md` 的定位提供证据基础；为 `governance-design.md` 的机制设计提供蓝图来源。
方法说明：结论综合学术文献、社区方法论、系统研究史与产品实测调研（2026-10 检索）。

## 一、学术界：PIM（个人信息管理）

### Malone 1983《How do people organize their desks?》（Xerox PARC）

发现 **filers（归档派）/ pilers（堆积派）** 两种并存策略。关键洞察：piler 不是懒——堆放是把「常用性」编码进物理位置（重要的在右手边、有视觉线索）。
**对本项目的证据**：不要假设人人该归档；「最近文件」的可见性本身是合法组织形式。

### Whittaker & Sidner 1996《Email Overload》（CHI'96）

发现三种真实人群：frequent filers / spring cleaners / no filers。归档失败的三个机制：

1. **文件夹增殖**——建了太多不敢维护；
2. **过早归档**（premature filing）——把未完结的事归档后遗忘位置；
3. **检索失败**——归档时清楚，检索时想不起文件夹名。

根源结论：**归档成本即时、收益遥远且不确定 → 制度性失败**。
**对本项目的证据**：「Inbox 会烂」有 30 年实证背书；解法是把成本压到趋近零（见 vision 原则 2）。

### Bergman 系列 与《The Science of Managing Our Digital Stuff》（2016, MIT Press）

反直觉发现：尽管归档困难，**用户用自建文件夹检索的成功率常高于搜索**——文件夹编码了搜索无法匹配的**主观属性**（「我那种乱糟糟的合同」输不进搜索框）。
**对本项目的证据**：结构必须由用户亲手造、保持轻量；工具不可用 AI 结构取代之；搜索做补位而非替代。

### KFTF（Keeping Found Things Found，华盛顿大学，William Jones）

命题转换：管理的目的不是整洁而是**再找到**（refinding）。
**对本项目的证据**：北极星指标之一（找得回）；工具经手的每一次移动都应可溯源。

## 二、社区方法论

### Johnny.Decimal

机制：人生分 10 个**区域**（10-19、20-29…），每区域最多 10 个**类别**（11-19），类别内条目编号 `11.01、11.02`。
三条设计原理：强制有限（槽位有限逼当场取舍，杜绝增殖）；可念出的坐标（「它在三十点二」）；空号即未来（新领域认领空号，旧体系零改动）。
**可偷**：编号槽位即查重机制（坐标占用一目了然）；登记册 schema 直接采用其分区法。

### PARA（Tiago Forte, Building a Second Brain）

四层：Projects（有目标期限，一项目一文件夹）/ Areas（长期维护）/ Resources（主题素材）/ Archives（前三者不活跃项整体搬入）。核心动词只有一个：**移动**。新主题出现不改结构，只是新 Project 诞生。
弱点：Resources 易变垃圾抽屉；无软件强制执行。
**可偷**：退役协议（整夹归档、上下文完整保留）。

### GTD（David Allen）

五步循环：捕获→澄清→组织→回顾→执行；两分钟法则；每周回顾。
**可偷**：weekly review 从纪律变成工具产物——周报即节拍器（「本周新增 37，自动入位 29，8 个待确认」）。

### Zettelkasten / Obsidian

原子化 + 双向链接彻底放弃层级，用链接解决交叉。
**可偷**：「交叉由链接/引用解决、不由复制解决」的思想源头（对应逻辑视图设计）。

### r/datacurator

社区维护的文件整理规范（wiki + GitHub 标准文件树项目）。共识规则：ISO 8601 日期前缀（`2026-10-06`）；版本号 `v01/v02`（文件名禁 final）；文件名禁空格；顶层粗分（Media/Documents/Archive）。
**可偷**：整套命名规范翻译为工具的 lint 规则集。

## 三、系统研究史：三次「杀死文件夹」的尝试

| 尝试 | 思路 | 结局 |
| --- | --- | --- |
| Semantic File System（MIT, 1991） | 文件属性 + 查询即虚拟目录 | 原型，未普及 |
| WinFS（微软） | 关系型文件系统（SQL over files） | 随 Vista 砍掉，最著名阵亡 |
| Nepomuk / 语义桌面（KDE） | 本体 + 语义标注 | 边缘化 |

失败解释（Bergman）：**空间位置是人脑检索的拐杖，纯查询让人迷路**。
**教训**：不革文件夹的命，做文件夹的治理层。本项目路线（真实文件夹 + 登记册 + 规则）站在历史正确一侧。

## 四、产品界（2026-10 检索）

| 能力 | 代表产品 | 边界 |
| --- | --- | --- |
| 规则引擎自动归档 | Hazel（Mac）、DropIt / File Juggler（Windows） | 规则手写、只路由不治理——建十个重复文件夹照单全收 |
| AI 分类 | DEVONthink（Classify + See Also + Replicate） | 能力最全但闭源于其数据库内，不治理真实文件夹树 |
| 搜索兜底 | Everything（NTFS MFT 秒搜） | 只解决「找」，不解决「放」 |
| 新世代 AI organizer | Dropbox Dash、FilesMagic AI、ASCN.ai、ExplainX（2025-2026 一批） | 提议结构后即结束：无登记册、无出生查重、无生长协议、搬迁不可回滚 |
| 标签/视图 | macOS 标签、Eagle、Tabbles | 依赖自家索引，脱离产品即失效 |
| System One 决策模型 | Jev（闭源）、Laya（Apache 2.0 开源）、Nimble | 只做类型化判断不生成文本；与本项目工作负载高度对口，选型详见 `decision-models.md` |

**DEVONthink 三个值得单独记录的设计**：AI Classify（基于已有归类推荐目标，置信度分流的前辈）；See Also（跨库相似推荐——「交叉」的产品化线索）；**Replicate**（同一文件出现在多个分组、物理仅一份——复制引用不复制字节）。

## 五、空缺分析：配料齐全，这道菜没人做过

| 组合所需的配料 | 已有最佳实践 | 缺口 |
| --- | --- | --- |
| 层级 schema | Johnny.Decimal / PARA | 纯约定，无软件强制 |
| 文件路由 | Hazel / DEVONthink / 新 AI organizer | 不感知 schema，目标路径即兴 |
| 出生查重 | 无（仅 ExplainX 做事后跨夹查重） | 「新建前查重」无产品实现 |
| 生长协议（出生/退役） | PARA 方法论 | 无软件承载 |
| 命名 lint | r/datacurator 规范 | 纯文档，无工具 |
| 可回滚批量重排 | 无（竞品全部不可逆） | 本项目 sessions+rollback 已具备 |

结论：**治理闭环在主流产品中没有对应物**——这是 File-Pilot 的生态位，也是 `vision.md` 定位的直接依据。

## 六、参考入口

- Bergman & Whittaker,《The Science of Managing Our Digital Stuff》(MIT Press, 2016)
- Malone (1983), Whittaker & Sidner (CHI 1996) —— PIM 经典论文
- Johnny.Decimal 官网；r/datacurator wiki 与 GitHub 标准文件树项目
- Hazel / DEVONthink 官方文档（功能边界参照物）
- Dropbox Dash、FilesMagic、ASCN.ai（新世代 AI organizer 形态参照）
