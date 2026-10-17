-- 本地决策模型影子模式对齐记录（decision-models.md §5 T1：只记录不生效）。
-- 每个文件最多两行：level='area'（领域级）与 level='project'（项目级）。
-- agree 仅在模型给出有效预测（predicted_id 非 NULL）时有意义：
-- 1 = predicted_id = expected_id，0 = 不一致，NULL = 弃权/未知/题目失败。
CREATE TABLE IF NOT EXISTS shadow_alignments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('area', 'project')),
  expected_id TEXT,
  predicted_id TEXT,
  confidence REAL,
  agree INTEGER,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shadow_alignments_session ON shadow_alignments(session_id);
CREATE INDEX IF NOT EXISTS idx_shadow_alignments_level_agree ON shadow_alignments(level, agree);
