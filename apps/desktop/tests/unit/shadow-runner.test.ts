import { describe, expect, it } from "vitest";

import {
  createClientFromShadowConfig,
  createHttpDecisionClient,
  runShadowAlignment,
  type DecisionOption,
  type LocalDecisionClient,
  type LocalDecisionChoice,
  type LocalDecisionInput,
  type ShadowRecord
} from "../../infra/llm/shadow-runner.js";
import {
  buildLocalDecisionRequest,
  defaultLocalDecisionEndpointPath,
  parseLocalDecisionResponse
} from "../../infra/llm/provider-adapter.js";

const createRecordingClient = (
  answerAt: (callIndex: number, input: LocalDecisionInput) => LocalDecisionChoice | null,
  options?: { rejectCallIndexes?: number[] }
): LocalDecisionClient & { calls: LocalDecisionInput[][] } => {
  const calls: LocalDecisionInput[][] = [];
  return {
    calls,
    choose: async (inputs: LocalDecisionInput[]) => {
      const callIndex = calls.length;
      calls.push(inputs);
      if (options?.rejectCallIndexes?.includes(callIndex) === true) {
        throw new Error("mock client failure");
      }
      return inputs.map((input) => answerAt(callIndex, input));
    }
  };
};

const coordinateOf = (areaNumber: number, areaName: string, projectNumber: number, projectName: string) => ({
  areaNumber,
  areaName,
  projectNumber,
  projectName
});

const buildItems = () => [
  {
    fileId: "f-1",
    fileName: "个人情况说明.doc",
    coordinate: coordinateOf(10, "个人事务", 1, "个人情况说明")
  },
  {
    fileId: "f-2",
    fileName: "工作规则.doc",
    coordinate: coordinateOf(20, "工作制度", 2, "部门规则")
  },
  {
    fileId: "f-3",
    fileName: "无坐标文件.txt"
  }
];

describe("shadow-runner", () => {
  it("runs two-level decomposition: area options deduped first, then per-area project options", async () => {
    const client = createRecordingClient((_callIndex, input) => ({
      // 域级全答 10；项目级答 1
      choiceId: input.id.startsWith("area:") ? "10" : "1",
      confidence: 0.8
    }));

    const records: ShadowRecord[] = [];
    const result = await runShadowAlignment({
      client,
      sessionId: "s-1",
      items: [
        ...buildItems(),
        { fileId: "f-4", fileName: "项目周报.docx", coordinate: coordinateOf(10, "个人事务", 3, "工作汇报") }
      ],
      record: (rec) => {
        records.push(rec);
      }
    });

    // 两级顺序：第一批全部域级问题，第二批项目级问题
    expect(client.calls).toHaveLength(2);
    const [areaCall, projectCall] = client.calls;
    expect(areaCall).toHaveLength(3);
    for (const input of areaCall ?? []) {
      expect(input.id.startsWith("area:")).toBe(true);
      // 去重后的领域选项集（10 个人事务 + 20 工作制度），每题相同且含文件名
      expect(input.options.map((option: DecisionOption) => option.id)).toEqual(["10", "20"]);
      expect(input.prompt).toContain("「");
    }

    expect(projectCall).toHaveLength(3);
    // 项目级选项 = 预测领域(10)内的项目去重：1 个人情况说明、3 工作汇报
    expect(projectCall?.[0]?.options.map((option) => option.id)).toEqual(["1", "3"]);
    expect(projectCall?.[0]?.prompt).toContain("个人事务");
    expect(result).toEqual({ recorded: 6, skipped: null });
  });

  it("records expected/predicted/agree for both levels with ids in registry-number space", async () => {
    const client = createRecordingClient((_callIndex, input) => {
      if (input.id === "area:f-1") {
        return { choiceId: "10", confidence: 0.9 };
      }
      if (input.id === "project:f-1") {
        return { choiceId: "2", confidence: 0.4 };
      }
      return { choiceId: null, confidence: 0.1 };
    });

    const records: ShadowRecord[] = [];
    await runShadowAlignment({
      client,
      sessionId: "s-2",
      items: buildItems(),
      record: (rec) => {
        records.push(rec);
      }
    });

    const areaRecord = records.find((rec) => rec.level === "area" && rec.fileId === "f-1");
    expect(areaRecord).toMatchObject({
      sessionId: "s-2",
      level: "area",
      expectedId: "10",
      predictedId: "10",
      confidence: 0.9,
      agree: true
    });

    const projectRecord = records.find((rec) => rec.level === "project" && rec.fileId === "f-1");
    expect(projectRecord).toMatchObject({
      level: "project",
      expectedId: "1",
      predictedId: "2",
      confidence: 0.4,
      agree: false
    });

    // 弃权题：predicted/agree 为 null；置信保留模型对弃权的校准值
    //（decision-models.md §5：Null 弃权率权衡曲线需要弃权置信数据）。
    const abstainRecord = records.find((rec) => rec.level === "area" && rec.fileId === "f-2");
    expect(abstainRecord).toMatchObject({
      expectedId: "20",
      predictedId: null,
      confidence: 0.1,
      agree: null
    });
    // f-2 域级弃权 → 无项目级记录
    expect(records.filter((rec) => rec.fileId === "f-2" && rec.level === "project")).toHaveLength(0);
    // 无坐标文件不参与
    expect(records.some((rec) => rec.fileId === "f-3")).toBe(false);
  });

  it("skips silently with null client", async () => {
    const records: ShadowRecord[] = [];
    const result = await runShadowAlignment({
      client: null,
      sessionId: "s-3",
      items: buildItems(),
      record: (rec) => {
        records.push(rec);
      }
    });

    expect(result).toEqual({ recorded: 0, skipped: "no-client" });
    expect(records).toHaveLength(0);
  });

  it("skips silently when no item carries coordinates", async () => {
    const client = createRecordingClient(() => null);
    const records: ShadowRecord[] = [];
    const result = await runShadowAlignment({
      client,
      sessionId: "s-4",
      items: [{ fileId: "f-1", fileName: "无坐标.txt" }],
      record: (rec) => {
        records.push(rec);
      }
    });

    expect(result).toEqual({ recorded: 0, skipped: "no-coordinates" });
    expect(client.calls).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it("treats a whole-batch client failure as per-question abstention without throwing", async () => {
    const client = createRecordingClient(() => null, { rejectCallIndexes: [0] });
    const records: ShadowRecord[] = [];
    const result = await runShadowAlignment({
      client,
      sessionId: "s-5",
      items: buildItems(),
      record: (rec) => {
        records.push(rec);
      }
    });

    // 域级整批失败 → 2 条 null 记录（f-3 无坐标不参与）；项目级无域级预测 → 全部跳过
    expect(result).toEqual({ recorded: 2, skipped: null });
    expect(records.every((rec) => rec.level === "area" && rec.agree === null && rec.predictedId === null)).toBe(true);
  });

  it("never throws when the record sink fails", async () => {
    const client = createRecordingClient(() => ({ choiceId: "10", confidence: 0.9 }));
    const result = await runShadowAlignment({
      client,
      sessionId: "s-6",
      items: buildItems(),
      record: () => {
        throw new Error("storage down");
      }
    });

    expect(result).toEqual({ recorded: 0, skipped: null });
  });

  it("createClientFromShadowConfig returns null when disabled or baseUrl empty", () => {
    expect(createClientFromShadowConfig({ enabled: false, endpointBaseUrl: "http://x", mode: "systemone" })).toBeNull();
    expect(createClientFromShadowConfig({ enabled: true, endpointBaseUrl: "  ", mode: "systemone" })).toBeNull();
    expect(
      createClientFromShadowConfig({ enabled: true, endpointBaseUrl: "http://127.0.0.1:9", mode: "systemone" })
    ).not.toBeNull();
  });
});

describe("http decision client", () => {
  const questions: LocalDecisionInput[] = [
    { id: "q-1", prompt: "文件「a.doc」属于哪个领域？", options: [{ id: "10", text: "10-个人事务" }] }
  ];

  it("default endpoint paths follow the mode convention", () => {
    expect(defaultLocalDecisionEndpointPath("systemone")).toBe("/v1/systemone");
    expect(defaultLocalDecisionEndpointPath("openai-chat")).toBe("/chat/completions");

    const systemOne = buildLocalDecisionRequest({ questions, baseUrl: "http://x", mode: "systemone" });
    const chat = buildLocalDecisionRequest({ questions, baseUrl: "http://x", mode: "openai-chat" });
    expect(systemOne.url).toBe("http://x/v1/systemone");
    expect(chat.url).toBe("http://x/chat/completions");
    expect(JSON.parse(systemOne.body)).toHaveProperty("questions");
    expect(JSON.parse(chat.body)).toHaveProperty("messages");
  });

  it("parses answers and maps per-question failures to null", async () => {
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { questions: Array<{ id: string }> };
      const answers = body.questions.map((question) => ({
        questionId: question.id,
        choiceId: question.id === "q-1" ? "10" : null,
        confidence: 0.7
      }));
      return new Response(JSON.stringify({ answers }), { status: 200 });
    }) as typeof fetch;

    const client = createHttpDecisionClient({ baseUrl: "http://mock", mode: "systemone", fetchImpl });
    const result = await client.choose([
      ...questions,
      { id: "q-2", prompt: "p", options: [{ id: "20", text: "t" }] }
    ]);

    expect(result[0]).toEqual({ choiceId: "10", confidence: 0.7 });
    expect(result[1]).toEqual({ choiceId: null, confidence: 0.7 });
  });

  it("returns all-null on non-2xx responses", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const client = createHttpDecisionClient({ baseUrl: "http://mock", mode: "systemone", fetchImpl });
    const result = await client.choose(questions);
    expect(result).toEqual([null]);
  });
});

describe("local decision response parsing", () => {
  it("parses systemone answers tolerantly", () => {
    const answers = parseLocalDecisionResponse({
      mode: "systemone",
      responseBody: JSON.stringify({
        answers: [
          { questionId: "q-1", choiceId: "10", confidence: 0.9 },
          { questionId: "q-2", choiceId: null, confidence: 0.2 },
          { broken: true },
          { questionId: "q-3", choiceId: "30" }
        ]
      })
    });

    expect(answers.get("q-1")).toEqual({ questionId: "q-1", choiceId: "10", confidence: 0.9 });
    expect(answers.get("q-2")).toEqual({ questionId: "q-2", choiceId: null, confidence: 0.2 });
    expect(answers.get("q-3")).toEqual({ questionId: "q-3", choiceId: "30", confidence: 0 });
    expect(answers.size).toBe(3);
  });

  it("extracts nested JSON from openai-chat content and survives corrupt bodies", () => {
    const ok = parseLocalDecisionResponse({
      mode: "openai-chat",
      responseBody: JSON.stringify({
        choices: [{ message: { content: `说明文本\n${JSON.stringify({ answers: [{ questionId: "q-1", choiceId: "10", confidence: 0.5 }] })}` } }]
      })
    });
    expect(ok.get("q-1")).toEqual({ questionId: "q-1", choiceId: "10", confidence: 0.5 });

    expect(parseLocalDecisionResponse({ mode: "systemone", responseBody: "not-json" }).size).toBe(0);
    expect(
      parseLocalDecisionResponse({ mode: "openai-chat", responseBody: JSON.stringify({ choices: [] }) }).size
    ).toBe(0);
  });
});
