import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createHttpDecisionClient,
  runShadowAlignment,
  type ShadowRecord
} from "../../infra/llm/shadow-runner.js";
import { closeAllSqliteDatabases, openSqliteDatabase } from "../../infra/storage/sqlite/db.js";
import { runMigrations } from "../../infra/storage/sqlite/migration-runner.js";
import {
  appendShadowRecords,
  shadowSummary,
  type ShadowSummary
} from "../../infra/storage/sqlite/repositories/shadow-repository.js";
import { startMockDecisionServer, type MockDecisionServer } from "../unit/helpers/decision-mock-server.js";

/**
 * 本地决策模型基准 harness（decision-models.md §5 验收基准的雏形）。
 *
 * 本会话不下载真实 Laya 模型：以本地 mock 端点验证 harness 全链路
 * （语料 fixture → 两级分解 → HTTP 决策端点 → 对齐记录 → 汇总报告）。
 * 换真实端点时只需替换 startMockDecisionServer 为真实 baseUrl——报告
 * 结构与断言保持不变。运行时评测（真实模型准确率/时延）留待模型下载。
 */

interface BenchmarkCorpusItem {
  fileName: string;
  areaNumber: number;
  areaName: string;
  projectNumber: number;
  projectName: string;
}

const CORPUS: BenchmarkCorpusItem[] = [
  { fileName: "个人情况说明.doc", areaNumber: 10, areaName: "个人事务", projectNumber: 1, projectName: "个人情况说明" },
  { fileName: "个人收入证明.pdf", areaNumber: 10, areaName: "个人事务", projectNumber: 1, projectName: "个人情况说明" },
  { fileName: "身份证复印件.jpg", areaNumber: 10, areaName: "个人事务", projectNumber: 2, projectName: "个人证件" },
  { fileName: "户口本扫描件.pdf", areaNumber: 10, areaName: "个人事务", projectNumber: 2, projectName: "个人证件" },
  { fileName: "工作规则.doc", areaNumber: 20, areaName: "工作制度", projectNumber: 1, projectName: "规章制度" },
  { fileName: "员工手册v2.docx", areaNumber: 20, areaName: "工作制度", projectNumber: 1, projectName: "规章制度" },
  { fileName: "部门季度计划.xlsx", areaNumber: 20, areaName: "工作制度", projectNumber: 2, projectName: "工作计划" },
  { fileName: "年度工作计划.pptx", areaNumber: 20, areaName: "工作制度", projectNumber: 2, projectName: "工作计划" },
  { fileName: "部门考勤.xlsx", areaNumber: 30, areaName: "人事考勤", projectNumber: 1, projectName: "考勤记录" },
  { fileName: "三月考勤汇总表.xlsx", areaNumber: 30, areaName: "人事考勤", projectNumber: 1, projectName: "考勤记录" },
  { fileName: "请假条.doc", areaNumber: 30, areaName: "人事考勤", projectNumber: 1, projectName: "考勤记录" },
  { fileName: "绩效自评表.doc", areaNumber: 30, areaName: "人事考勤", projectNumber: 2, projectName: "绩效考核" },
  { fileName: "KPI考核结果通知.pdf", areaNumber: 30, areaName: "人事考勤", projectNumber: 2, projectName: "绩效考核" }
];

const tempDirs: string[] = [];
const mockServers: MockDecisionServer[] = [];

afterEach(async () => {
  closeAllSqliteDatabases();
  await Promise.all(mockServers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const buildItems = (sessionId: string) =>
  CORPUS.map((entry, index) => ({
    fileId: `${sessionId}-${index}`,
    fileName: entry.fileName,
    coordinate: {
      areaNumber: entry.areaNumber,
      areaName: entry.areaName,
      projectNumber: entry.projectNumber,
      projectName: entry.projectName
    }
  }));

/** 按影子 runner 的题目 id 约定（area:<fileId> / project:<fileId>）生成正确答案表。 */
const buildAnswerKey = (sessionId: string): Record<string, string> => {
  const answers: Record<string, string> = {};
  CORPUS.forEach((entry, index) => {
    const fileId = `${sessionId}-${index}`;
    answers[`area:${fileId}`] = String(entry.areaNumber);
    answers[`project:${fileId}`] = String(entry.projectNumber);
  });
  return answers;
};

const setupBenchmarkDb = async () => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-shadow-bench-"));
  tempDirs.push(root);
  const db = openSqliteDatabase(join(root, "data.db"));
  await runMigrations({
    db,
    migrationsDir: join(process.cwd(), "apps/desktop/infra/storage/sqlite/migrations")
  });
  return db;
};

const runBenchmarkOnce = async (params: {
  sessionId: string;
  server: MockDecisionServer;
  db: ReturnType<typeof openSqliteDatabase>;
}): Promise<ShadowSummary> => {
  const client = createHttpDecisionClient({
    baseUrl: params.server.baseUrl,
    mode: "systemone",
    timeoutMs: 5000
  });

  const records: ShadowRecord[] = [];
  const result = await runShadowAlignment({
    client,
    sessionId: params.sessionId,
    items: buildItems(params.sessionId),
    record: (rec) => {
      records.push(rec);
    }
  });

  expect(result.skipped).toBeNull();
  // 每个文件两条（领域级 + 项目级），13 个语料文件共 26 条
  expect(result.recorded).toBe(CORPUS.length * 2);

  appendShadowRecords(params.db, records);
  const summary = shadowSummary(params.db);
  return summary;
};

describe("qa-decision-model-benchmark", () => {
  it("produces an agree-rate report over the Chinese corpus (perfect and imperfect runs)", async () => {
    // ---- Run 1：mock 全对 → agreeRate = 1 ----
    const perfectServer = await startMockDecisionServer({
      mode: "systemone",
      answers: buildAnswerKey("perfect")
    });
    mockServers.push(perfectServer);
    const perfectDb = await setupBenchmarkDb();
    const perfectSummary = await runBenchmarkOnce({ sessionId: "perfect", server: perfectServer, db: perfectDb });

    expect(perfectSummary.total).toBe(CORPUS.length * 2);
    expect(perfectSummary.agreeRate).toBe(1);
    expect(perfectSummary.byLevel.area.agreeRate).toBe(1);
    expect(perfectSummary.byLevel.project.agreeRate).toBe(1);

    // ---- Run 2：脚本错 2 题（域级前 2 题答错 → 这 2 个文件两级均失配） ----
    const imperfectServer = await startMockDecisionServer({
      mode: "systemone",
      answers: buildAnswerKey("imperfect"),
      wrongCount: 2
    });
    mockServers.push(imperfectServer);
    const imperfectDb = await setupBenchmarkDb();
    const imperfectSummary = await runBenchmarkOnce({ sessionId: "imperfect", server: imperfectServer, db: imperfectDb });

    // 前两个文件的域级预测被脚本改错（确定性），其项目级因域级错位也失配：
    // 26 条中 22 条一致，域级/项目级各 11/13。
    expect(imperfectSummary.total).toBe(CORPUS.length * 2);
    expect(imperfectSummary.agreed).toBe(CORPUS.length * 2 - 4);
    expect(imperfectSummary.agreeRate).toBeCloseTo((CORPUS.length * 2 - 4) / (CORPUS.length * 2), 10);
    expect(imperfectSummary.byLevel.area.agreed).toBe(CORPUS.length - 2);
    expect(imperfectSummary.byLevel.project.agreed).toBe(CORPUS.length - 2);

    // ---- 报告落盘：test-results/qa/decision-benchmark-<ts>.json ----
    const report = {
      generatedAt: new Date().toISOString(),
      harness: "shadow-two-level",
      endpoint: { kind: "mock", mode: "systemone" as const },
      corpusSize: CORPUS.length,
      runs: [
        { name: "all-correct", ...perfectSummary },
        { name: "wrong-2", ...imperfectSummary }
      ]
    };
    const outDir = join(process.cwd(), "test-results", "qa");
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `decision-benchmark-${Date.now()}.json`);
    await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

    const persisted = JSON.parse(await readFile(outPath, "utf-8")) as typeof report;
    expect(persisted.harness).toBe("shadow-two-level");
    expect(persisted.corpusSize).toBe(CORPUS.length);
    expect(persisted.runs).toHaveLength(2);
    for (const run of persisted.runs) {
      expect(run.total).toBe(CORPUS.length * 2);
      expect(typeof run.agreeRate).toBe("number");
      expect(run.byLevel.area).toHaveProperty("agreeRate");
      expect(run.byLevel.project).toHaveProperty("agreeRate");
    }
  });
});
