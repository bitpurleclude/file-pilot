# 研究笔记：可完善本软件的学术工作

版本：v1.0（2026-10-10）
用途：记录与治理层各模块直接对应的学术研究，作为机制设计的理论依据与后续深化方向。
关联：`vision.md`（原则来源）、`governance-design.md`（机制）、`decision-models.md`（选型）。

## 1. 不确定性与弃权：从阈值切分升级为共形预测（Conformal Prediction）

**对应模块**：Inbox 管线的置信分流（§4）、寄存区判定。

现状设计用朴素阈值（confidence ≥ 阈值 → 自动入位）。相关研究提供了有统计保证的升级路径：

- **"No Need for Learning to Defer? Training-Free Deferral for Human-AI Collaboration"**（arXiv）——基于共形预测的**免训练**人机协作弃权框架：不需要任何额外训练，即可给出"分布无关的错误率保证"的弃权决策。直接可用：把"寄存 vs 自动入位"从拍脑袋阈值升级为"以 95% 置信保证自动入位错误率 ≤ ε"。
- **"Learning Conformal Abstention Policies for Adaptive Risk Management in Language Models"**（arXiv, 2025-02）——可学习的弃权策略，适配 LLM。
- **"Conformal Prediction Sets Improve Human Decision Making"**（Cresswell et al.，84+ 引用）——实证表明：给人看**预测集**（"是 A（72%）或 B（21%）"）比给 top-1 更能提升人类决策质量。**对周报的启发**：待确认项不只给一个答案，给出前两个候选坐标 + 概率，人工改判更快更准。
- **"Selective Prediction for Natural Language Processing"**（Xin et al., ACL 2021）——NLP 选择性预测综述，定义了该领域的问题框架。
- **"Conformal Validation: A deferral policy using uncertainty"**（Horton, 2025）——风险控制与弃权策略结合的系统化方法。

**行动项**：周报/自动入位的分流阈值改为共形校准（免训练方法优先），错误率保证写入产品指标。

## 2. 级联经济学：FrugalGPT 验证我们的漏斗形态

**对应模块**：管线整体（规则 → 本地决策模型 → 云端 LLM → 本地兜底）。

- **FrugalGPT**（Chen et al., Stanford）——LLM 级联策略（prompt 适配 / 模型近似 / **级联**：便宜模型先行，低置信才升级贵模型），实测**最高 98% 成本削减仍匹配 GPT-4 质量**。
- 对我们的意义：三级漏斗不是权宜设计，是有正式成本-质量理论的架构。升级阈值（何时从本地升级到云端）应按 FrugalGPT 的置信-成本权衡原则设定，而非固定不变。

## 3. 少样本微调飞轮：SetFit + 小模型微调优越性

**对应模块**：规则学习/周报改判数据 → 本地模型微调（`decision-models.md` §5 采纳路径）。

- **SetFit**（Tunstall et al., 2022，arXiv:2209.11055，435+ 引用）——对比式 Siamese 微调预训练 Sentence Transformer，**无需 prompt、几十条样本即可见效**，样本效率与抗噪性显著优于标准微调。对我们：改判样本从第一条起就有用，不必等"几千条"。
- **Bucher et al.（苏黎世大学，210+ 引用）**——实证：**微调后的小模型在文本分类上显著优于零样本的大生成模型**。为"本地小模型接管中间层"提供了直接的文献支撑。

**行动项**：微调路径按 SetFit 优先评估（比全量微调 Laya 门槛更低）；寄存区样本按对比对格式持续积累。

## 4. 层级文本分类：两级分解决策的正名

**对应模块**：坐标认领的决策分解（先领域 ≤8 选项 → 后项目 ≤10 选项，`decision-models.md` §4.2）。

- **Zangari et al.《Hierarchical Text Classification and Its Foundations》**（MDPI 2024 综述，89+ 引用）——HTC 方法分三类：**flat（扁平，忽略层级）/ local（每个父节点训练局部分类器）/ global（整层级一次建模）**。我们的两级分解正是经典 **local 方法**——这是被充分研究的成熟路线，不是权宜之计。
- **HiAGM**（阿里巴巴，"Exploiting Global and Local Hierarchies"）——global 路线的代表（层级结构编码为先验）。作为未来选项记录：若选项数增长到 local 分解也吃力，可评估 global 层级模型。
- **LSHTC 基准**（Wikipedia 325,056 类）——层级分类规模化极限的参照系；我们的 80 坐标在层级分类谱系里属于玩具规模，方法选择自由度极大。

## 5. 近重复检测：重叠检测的具体算法

**对应模块**：建域查重的三级查重之 c（内容抽样比对）、全盘扫描报告（阶段④）。

- **SimHash**（Manku et al., Google《Detecting Near-Duplicates for Web Crawling》，1000+ 引用）——文档指纹化后近似余弦相似度比对，网页去重的工业级经典。对文件夹签名（目录内文件名集合 + 内容抽样指纹）直接适用。
- **MinHash + LSH + Jaccard**——估算集合相似度的标准组合（Milvus 等向量库原生支持 LSH）；对"两个文件夹是否同一主题"给出可计算的相似度而非凭感觉。

**行动项**：重叠检测实现选型 = 名称精确/编辑距离（快）→ MinHash/SimHash 指纹（中）→ LLM 语义判定（慢，仅前两级命中嫌疑时）。三级漏斗与整体管线哲学一致。

## 6. 校准纪律

Laya 独立评测暴露的问题（原始 ECE 0.466，温度重拟合后 0.081）是一般性教训：**决策模型的原始置信度不可直接当作分流阈值**。任何接入的模型（本地或云端）必须过一次校准检查（可靠性图/ ECE），必要时做温度缩放（Guo et al. 2017 的标准方法）。此纪律应写入模型接入的验收清单。

## 7. 检索方向的前瞻（未排期）

- 逻辑视图与"相似推荐"（See Also 语义）的自然深化是**嵌入向量**：对文件名+抽取文本做 embedding，视图成员从规则匹配升级为语义近邻。当前不排期；先落地规则视图，待本地决策模型稳定后评估嵌入模型的本地部署（与 Laya 同一分发管线）。
- PIM 学术圈（Bergman/Whittaker 之外）值得持续跟踪：KFTF 项目组的后续工作、CHI/SIGIR 每年的 personal information management 相关 session。

## 阅读清单（按优先级）

1. SetFit 论文（arXiv:2209.11055）——微调飞轮的工程起点
2. Training-Free Deferral（共形预测人机协作）——分流机制的升级依据
3. FrugalGPT（arXiv:2305.05176）——级联成本理论
4. Zangari et al. HTC 综述（MDPI 2024）——层级分类方法地图
5. Manku et al. SimHash（Google Research）——重叠检测算法
6. Guo et al.《On Calibration of Modern Neural Networks》(ICML 2017)——校准纪律
