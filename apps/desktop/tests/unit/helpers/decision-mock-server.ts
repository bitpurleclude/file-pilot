import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * 本地决策端点 mock（node:http）：影子模式 harness 用。
 *
 * 可配置"正确率脚本"：测试按 fixture 提供每题的正确选项表（answers），
 * `wrongCount` 控制前 N 题故意答错（从其余选项中挑一个）以模拟 imperfect
 * 模型；`status` 可注入 HTTP 失败路径。同时支持 systemone（结构化 questions
 * 端点）与 openai-chat（借对话端点承载 JSON 负载）两种请求/响应形态。
 */

export interface MockDecisionScript {
  /** 请求/响应形态，须与被测客户端一致。 */
  mode: "systemone" | "openai-chat";
  /** questionId → 正确选项 id（由测试按 fixture 的期望坐标生成）。 */
  answers: Readonly<Record<string, string>>;
  /** 前 N 题故意答错（按请求到达顺序），0 = 全对。 */
  wrongCount?: number;
  /** 覆盖 HTTP 状态码（默认 200），用于测试失败路径。 */
  status?: number;
  /** 应答置信度（默认 0.9）。 */
  confidence?: number;
}

export interface MockQuestionObservation {
  id: string;
  prompt: string;
  optionIds: string[];
  answeredChoiceId: string | null;
}

export interface MockDecisionServer {
  /** 形如 http://127.0.0.1:<port>，可直接作为 createHttpDecisionClient 的 baseUrl。 */
  baseUrl: string;
  port: number;
  /** 按到达顺序记录的题目观测（供断言两级分解的选项集与顺序）。 */
  questionsSeen: MockQuestionObservation[];
  /** 收到的原始请求路径列表（供断言默认端点路径）。 */
  pathsSeen: string[];
  close: () => Promise<void>;
}

interface ParsedQuestion {
  id: string;
  prompt: string;
  optionIds: string[];
}

const pickWrongOptionId = (optionIds: string[], correctId: string): string | null => {
  for (const optionId of optionIds) {
    if (optionId !== correctId) {
      return optionId;
    }
  }
  return null;
};

/** 从请求体提取题目（兼容两种形态：questions 字段或 messages 中的 JSON 负载）。 */
const extractQuestions = (body: unknown): ParsedQuestion[] => {
  if (typeof body !== "object" || body === null) {
    return [];
  }

  const direct = body as { questions?: unknown };
  if (Array.isArray(direct.questions)) {
    return direct.questions
      .filter((raw): raw is Record<string, unknown> => typeof raw === "object" && raw !== null)
      .map((raw) => ({
        id: typeof raw.id === "string" ? raw.id : "",
        prompt: typeof raw.prompt === "string" ? raw.prompt : "",
        optionIds: Array.isArray(raw.options)
          ? raw.options
              .filter((option): option is Record<string, unknown> => typeof option === "object" && option !== null)
              .map((option) => (typeof option.id === "string" ? option.id : ""))
              .filter((id) => id.length > 0)
          : []
      }));
  }

  const chat = body as { messages?: unknown };
  const lastMessage = Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : undefined;
  if (typeof lastMessage !== "object" || lastMessage === null) {
    return [];
  }
  const content = (lastMessage as { content?: unknown }).content;
  if (typeof content !== "string") {
    return [];
  }
  try {
    return extractQuestions(JSON.parse(content) as unknown);
  } catch {
    return [];
  }
};

export const startMockDecisionServer = async (script: MockDecisionScript): Promise<MockDecisionServer> => {
  const wrongCount = script.wrongCount ?? 0;
  const confidence = script.confidence ?? 0.9;
  const questionsSeen: MockQuestionObservation[] = [];
  const pathsSeen: string[] = [];

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      pathsSeen.push(request.url ?? "");

      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
      } catch {
        parsedBody = null;
      }

      if (script.status !== undefined && script.status !== 200) {
        response.writeHead(script.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "mock-injected-failure" }));
        return;
      }

      const questions = extractQuestions(parsedBody);
      const answers = questions.map((question, index) => {
        const correctId = script.answers[question.id] ?? null;
        const shouldWrong = index < wrongCount && correctId !== null;
        const choiceId = shouldWrong
          ? pickWrongOptionId(question.optionIds, correctId)
          : correctId;
        questionsSeen.push({
          id: question.id,
          prompt: question.prompt,
          optionIds: question.optionIds,
          answeredChoiceId: choiceId
        });
        return { questionId: question.id, choiceId, confidence };
      });

      const payload = { answers };
      const responseJson =
        script.mode === "openai-chat"
          ? {
              choices: [
                { message: { content: JSON.stringify(payload) } }
              ]
            }
          : payload;

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(responseJson));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    questionsSeen,
    pathsSeen,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      })
  };
};
