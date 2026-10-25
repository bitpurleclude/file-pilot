import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

/**
 * LLM OpenAI 兼容 stub（e2e 专用，纯 node:http 实现，不访问任何外部 API）。
 *
 * 职责：
 * 1. 监听 127.0.0.1 随机端口，处理 POST 请求（路径以 /chat/completions 结尾）；
 * 2. 判别单文件（classify.v1）vs 批式（classify-batch.v1）prompt；
 * 3. 返回确定性分类结果（默认包在 ```json 围栏里，顺带端到端验证围栏剥离）；
 * 4. 记录每个收到的请求（model / isBatch / ids / headers）供 spec 断言。
 */

/**
 * 批式模板（classify-batch.v1.njk）渲染结果独有的特征串：
 * - "输入文件列表"：批式模板的输入段标题（单文件模板的标题是"输入："）；
 * - "JSON 数组"：批式模板要求输出 JSON 数组（单文件模板只说"返回 JSON"）。
 * 单文件模板（classify.v1.njk）独有 "摘要："，可用于反向确认。
 */
const BATCH_PROMPT_MARKERS: readonly string[] = ["输入文件列表", "JSON 数组"];

/** 单文件模板（classify.v1.njk）渲染结果独有特征串，用于断言判别的反向正确性。 */
export const SINGLE_PROMPT_MARKER = "摘要：";

/**
 * 批式模板逐条渲染的 id 行形如 "- id: <uuid>"（模板第 23 行 `- id: {{ file.id }}`）。
 * 行首锚定 + `-\s*id:` 前缀可避开模板里 JSON 示例中的 `"id":` 字段说明。
 */
const BATCH_ID_LINE_PATTERN = /^\s*-\s*id:\s*(\S+)\s*$/gm;

export interface StubRequest {
  /** 请求体中的 model 字段 */
  model: string;
  /** true = 批式模板（classify-batch.v1），false = 单文件模板（classify.v1） */
  isBatch: boolean;
  /** 批式请求中提取到的全部 item id（单文件请求恒为 []） */
  ids: string[];
  /** 请求头（小写键名，值为字符串；多值头以 ", " 连接） */
  headers: Record<string, string>;
  /** 最后一条 user 消息原文（判别与提取均基于它） */
  userMessage: string;
}

export interface StubResponderResult {
  /** HTTP 状态码（200 才会携带 content） */
  status: number;
  /** 放入 choices[0].message.content 的原文（不做围栏包装，可返回非法 JSON 测试降级） */
  content: string;
}

export type StubResponder = (request: StubRequest) => StubResponderResult | undefined;

export interface LlmStubOptions {
  /** "unauthorized"：所有请求返回 401（不重试、不切备模型的确定性失败路径） */
  mode?: "unauthorized";
  /** 自定义响应器；返回 undefined 时使用默认确定性响应 */
  responder?: StubResponder;
}

export interface LlmStub {
  /** 例如 http://127.0.0.1:54321/v1（provider.baseUrl 直接指向它） */
  url: string;
  close(): Promise<void>;
  /** 收到的全部请求（按到达顺序） */
  requests(): StubRequest[];
}

/** 与真实响应一致的固定 usage，spec 断言 reasons 中的 usage:pt:42:ct:17。 */
const STUB_USAGE = { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 } as const;

/** 默认确定性分类结果 */
const STUB_CLASSIFICATION = {
  purpose: "Documents",
  project: "StubProject",
  confidence: 0.9,
  reasons: ["stub"]
} as const;

/** 判别 prompt 属于批式模板还是单文件模板。 */
export const isBatchPrompt = (userMessage: string): boolean => {
  return BATCH_PROMPT_MARKERS.some((marker) => userMessage.includes(marker));
};

/** 从批式 prompt 中按 "- id: <id>" 行提取全部 item id（保持输入顺序）。 */
export const extractBatchIds = (userMessage: string): string[] => {
  const ids: string[] = [];
  for (const match of userMessage.matchAll(BATCH_ID_LINE_PATTERN)) {
    const id = match[1];
    if (id !== undefined && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
};

const normalizeHeaders = (headers: IncomingHttpHeaders): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
};

const parseChatRequestBody = (body: string): { model: string; userMessage: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return { model: "", userMessage: "" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { model: "", userMessage: "" };
  }

  const record = parsed as { model?: unknown; messages?: unknown };
  const model = typeof record.model === "string" ? record.model : "";

  let userMessage = "";
  if (Array.isArray(record.messages)) {
    const messages: unknown[] = record.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (typeof message !== "object" || message === null) {
        continue;
      }
      const item = message as { role?: unknown; content?: unknown };
      if (item.role === "user" && typeof item.content === "string") {
        userMessage = item.content;
        break;
      }
    }
  }

  return { model, userMessage };
};

const fenceJson = (payload: string): string => "```json\n" + payload + "\n```";

const buildDefaultContent = (request: StubRequest): string => {
  if (request.isBatch) {
    const entries = request.ids.map((id) => ({ id, ...STUB_CLASSIFICATION }));
    return fenceJson(JSON.stringify(entries, null, 2));
  }
  return fenceJson(JSON.stringify(STUB_CLASSIFICATION, null, 2));
};

const buildChatCompletionBody = (model: string, content: string): Record<string, unknown> => {
  return {
    id: "chatcmpl-file-pilot-e2e-stub",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    usage: STUB_USAGE
  };
};

export const startLlmStub = async (options: LlmStubOptions = {}): Promise<LlmStub> => {
  const requests: StubRequest[] = [];

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const isChatCompletions = req.method === "POST" && /\/chat\/completions$/.test(url);

    if (!isChatCompletions) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stub: not found" } }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      const { model, userMessage } = parseChatRequestBody(body);
      const request: StubRequest = {
        model,
        isBatch: isBatchPrompt(userMessage),
        ids: extractBatchIds(userMessage),
        headers: normalizeHeaders(req.headers),
        userMessage
      };
      requests.push(request);

      if (options.mode === "unauthorized") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            message: "stub: invalid api key",
            type: "invalid_request_error",
            code: "invalid_api_key"
          }
        }));
        return;
      }

      const custom = options.responder?.(request);
      if (custom !== undefined) {
        res.writeHead(custom.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(buildChatCompletionBody(request.model, custom.content)));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(
        buildChatCompletionBody(request.model, buildDefaultContent(request))
      ));
    });
    req.on("error", () => {
      // 客户端中断等网络层噪音不影响 stub 状态，直接销毁连接。
      req.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("llm stub: failed to acquire a 127.0.0.1 port");
  }

  const close = async (): Promise<void> => {
    // Electron 主进程的 fetch（undici）会保持 keep-alive 连接，
    // close 前先关空闲连接、close 后兜底关全部连接，保证测试干净退出。
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server.closeAllConnections();
  };

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close,
    requests: () => [...requests]
  };
};
