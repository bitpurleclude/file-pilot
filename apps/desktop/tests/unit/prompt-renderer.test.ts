import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AppError } from "../../shared/errors/app-error.js";
import type { CoordinateOption } from "../../shared/types/registry.js";
import type { ContentSummary, FileItem } from "../../shared/types/workflow.js";
import {
  CLASSIFY_BATCH_PROMPT_VERSION,
  CLASSIFY_PROMPT_VERSION,
  renderClassifyBatchPrompt,
  renderClassifyPrompt
} from "../../infra/llm/prompt-renderer.js";

/** 坐标清单条件段标题（模板在提供 coordinates 时渲染；无坐标输出中不得出现）。 */
const COORDINATE_LIST_MARKER = "可用项目坐标清单";

/** 读取模板文件换行风格，使逐字节基线断言在 LF/CRLF 检出环境下都成立。 */
const templateJoiner = (): string => {
  const template = readFileSync(
    join("apps", "desktop", "infra", "llm", "templates", "classify.v1.njk"),
    "utf-8"
  );
  return template.includes("\r\n") ? "\r\n" : "\n";
};

const baselineItem: FileItem = {
  id: "baseline-id",
  path: "C:/baseline/note.md",
  name: "note.md",
  ext: "md",
  size: 42,
  createdAt: "2026-02-12T00:00:00.000Z",
  modifiedAt: "2026-02-12T00:00:00.000Z",
  mime: "text/markdown"
};

const baselineSecondItem: FileItem = {
  ...baselineItem,
  id: "baseline-id-2",
  name: "photo.png",
  ext: "png",
  mime: "image/png"
};

const baselineSummary: ContentSummary = {
  textSnippet: "基线摘要",
  keywords: ["基线", "关键词"],
  language: "zh-CN"
};

/** 无 coordinates 时单文件模板的逐字节基线（与模板文件换行风格一致）。 */
const legacySinglePrompt = (): string => {
  return [
    "你是一个文件分类助手。",
    "请根据文件元数据和摘要，返回 JSON：",
    "{",
    "  \"purpose\": \"Documents|Media|Code|Archives|Installers|Others|Study|Work|Design|Finance|Research\",",
    "  \"project\": \"项目名\",",
    "  \"confidence\": 0.0,",
    "  \"reasons\": [\"简短原因\"]",
    "}",
    "",
    "约束：",
    "1. 仅返回 JSON，不要解释，不要使用 Markdown 代码围栏。",
    "2. confidence 取值范围 0 到 1。",
    "3. project 为空时填 \"默认项目\"。",
    "4. project 为简短项目名，禁止路径分隔符、`..` 与 Windows 非法字符 \\/:*?\"<>|。",
    "",
    "输入：",
    "- 文件名：note.md",
    "- 扩展名：md",
    "- 大小：42",
    "- 摘要：基线摘要",
    "- 关键词：基线, 关键词",
    ""
  ].join(templateJoiner());
};

/** 无 coordinates 时批式模板的逐字节基线。 */
const legacyBatchPrompt = (): string => {
  return [
    "你是一个文件分类助手。",
    "请根据下列多个文件的元数据和关键词，批量分类并只输出 JSON 数组：",
    "[",
    "  {",
    "    \"id\": \"输入文件的 id\",",
    "    \"purpose\": \"Documents|Media|Code|Archives|Installers|Others|Study|Work|Design|Finance|Research\",",
    "    \"project\": \"项目名\",",
    "    \"confidence\": 0.0,",
    "    \"reasons\": [\"简短原因\"]",
    "  }",
    "]",
    "",
    "约束：",
    "1. 仅返回 JSON 数组，不要解释，不要使用 Markdown 代码围栏。",
    "2. 数组必须覆盖每一个输入文件，id 与输入一致，数组顺序与输入顺序一致。",
    "3. purpose 必须从枚举中选择。",
    "4. confidence 取值范围 0 到 1。",
    "5. project 为空时填 \"默认项目\"。",
    "6. project 为简短项目名，禁止路径分隔符、`..` 与 Windows 非法字符 \\/:*?\"<>|。",
    "",
    "输入文件列表：",
    "",
    "- id: baseline-id",
    "  文件名：note.md",
    "  扩展名：md",
    "  大小：42",
    "  关键词：基线, 关键词",
    "",
    "- id: baseline-id-2",
    "  文件名：photo.png",
    "  扩展名：png",
    "  大小：42",
    "  关键词：基线, 关键词",
    "",
    ""
  ].join(templateJoiner());
};

const coordinateOptions: CoordinateOption[] = [
  { areaNumber: 30, areaName: "考公", projectNumber: 1, projectName: "行测" },
  { areaNumber: 40, areaName: "开发", projectNumber: 2, projectName: "工具" }
];

describe("prompt-renderer", () => {
  it("renders classify template when process cwd is outside repo", () => {
    const originalCwd = process.cwd();
    const isolatedCwd = mkdtempSync(join(tmpdir(), "file-pilot-prompt-cwd-"));

    try {
      process.chdir(isolatedCwd);

      const prompt = renderClassifyPrompt({
        item: {
          id: "f-2",
          path: "C:/demo/notes.txt",
          name: "notes.txt",
          ext: "txt",
          size: 10,
          createdAt: "2026-02-12T00:00:00.000Z",
          modifiedAt: "2026-02-12T00:00:00.000Z",
          mime: "text/plain"
        },
        summary: {
          textSnippet: "outside repo cwd",
          keywords: ["outside", "cwd"],
          language: "en"
        }
      });

      expect(prompt).toContain("notes.txt");
      expect(prompt).toContain("outside repo cwd");
    } finally {
      process.chdir(originalCwd);
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it("renders classify template from file with validated variables", () => {
    const prompt = renderClassifyPrompt({
      item: {
        id: "f-1",
        path: "C:/demo/note.md",
        name: "note.md",
        ext: "md",
        size: 42,
        createdAt: "2026-02-12T00:00:00.000Z",
        modifiedAt: "2026-02-12T00:00:00.000Z",
        mime: "text/markdown"
      },
      summary: {
        textSnippet: "这是一个学习记录",
        keywords: ["学习", "记录"],
        language: "zh-CN"
      }
    });

    expect(CLASSIFY_PROMPT_VERSION).toBe("classify.v1");
    expect(prompt).toContain("note.md");
    expect(prompt).toContain("学习");
    expect(prompt).toContain("记录");
  });

  it("throws identifiable error when required variable is missing", () => {
    expect(() => renderClassifyPrompt({
      item: {
        id: "f-1",
        path: "C:/demo/note.md",
        name: "",
        ext: "md",
        size: 42,
        createdAt: "2026-02-12T00:00:00.000Z",
        modifiedAt: "2026-02-12T00:00:00.000Z",
        mime: "text/markdown"
      },
      summary: {
        textSnippet: "text",
        keywords: ["k1"],
        language: "zh-CN"
      }
    })).toThrowError(AppError);

    try {
      renderClassifyPrompt({
        item: {
          id: "f-1",
          path: "C:/demo/note.md",
          name: "",
          ext: "md",
          size: 42,
          createdAt: "2026-02-12T00:00:00.000Z",
          modifiedAt: "2026-02-12T00:00:00.000Z",
          mime: "text/markdown"
        },
        summary: {
          textSnippet: "text",
          keywords: ["k1"],
          language: "zh-CN"
        }
      });
    } catch (error) {
      expect((error as AppError).code).toBe("SYSTEM_PROMPT_RENDER_FAILED");
    }
  });

  it("renders batch template with per-item variables", () => {
    const prompt = renderClassifyBatchPrompt([
      {
        item: {
          id: "f-1",
          path: "C:/demo/note.md",
          name: "note.md",
          ext: "md",
          size: 42,
          createdAt: "2026-02-12T00:00:00.000Z",
          modifiedAt: "2026-02-12T00:00:00.000Z",
          mime: "text/markdown"
        },
        summary: {
          textSnippet: "学习记录",
          keywords: ["学习", "记录"],
          language: "zh-CN"
        }
      },
      {
        item: {
          id: "f-2",
          path: "C:/demo/photo.png",
          name: "photo.png",
          ext: "png",
          size: 2048,
          createdAt: "2026-02-12T00:00:00.000Z",
          modifiedAt: "2026-02-12T00:00:00.000Z",
          mime: "image/png"
        },
        summary: {
          textSnippet: "",
          keywords: ["照片"],
          language: "zh-CN"
        }
      }
    ]);

    expect(CLASSIFY_BATCH_PROMPT_VERSION).toBe("classify-batch.v1");
    expect(prompt).toContain("JSON 数组");
    expect(prompt).toContain("- id: f-1");
    expect(prompt).toContain("note.md");
    expect(prompt).toContain("- id: f-2");
    expect(prompt).toContain("photo.png");
    expect(prompt).toContain("学习");
    expect(prompt).toContain("记录");
    expect(prompt).toContain("照片");
    expect(prompt).toContain("\\/:*?\"<>|");
  });

  it("rejects empty batch input with a render failure error", () => {
    expect(() => renderClassifyBatchPrompt([])).toThrowError(AppError);

    try {
      renderClassifyBatchPrompt([]);
    } catch (error) {
      expect((error as AppError).code).toBe("SYSTEM_PROMPT_RENDER_FAILED");
    }
  });

  it("keeps the legacy single prompt byte-identical when coordinates are absent", () => {
    expect(renderClassifyPrompt({ item: baselineItem, summary: baselineSummary })).toBe(legacySinglePrompt());
  });

  it("keeps the legacy batch prompt byte-identical when coordinates are absent", () => {
    expect(renderClassifyBatchPrompt([
      { item: baselineItem, summary: baselineSummary },
      { item: baselineSecondItem, summary: baselineSummary }
    ])).toBe(legacyBatchPrompt());
  });

  it("renders the coordinate list and claim-or-NEW instructions for single classify", () => {
    const prompt = renderClassifyPrompt({ item: baselineItem, summary: baselineSummary, coordinates: coordinateOptions });

    expect(prompt).toContain(COORDINATE_LIST_MARKER);
    expect(prompt).toContain("- 30-考公/1-行测");
    expect(prompt).toContain("- 40-开发/2-工具");
    // 三条指令：只能认领清单坐标 / 不属于任何坐标时输出 NEW:<名称> / 不发明清单外坐标。
    expect(prompt).toContain("必须从下方「可用项目坐标清单」中认领坐标");
    expect(prompt).toContain("NEW:<简短中文名>");
    expect(prompt).toContain("不要发明清单外的坐标");
    // 坐标模式下不再渲染 legacy 自由命名约束。
    expect(prompt).not.toContain("4. project 为简短项目名");
  });

  it("renders the coordinate list and claim-or-NEW instructions for batch classify", () => {
    const prompt = renderClassifyBatchPrompt(
      [{ item: baselineItem, summary: baselineSummary }],
      coordinateOptions
    );

    expect(prompt).toContain(COORDINATE_LIST_MARKER);
    expect(prompt).toContain("- 30-考公/1-行测");
    expect(prompt).toContain("- 40-开发/2-工具");
    // project 约束段改写为"从清单认领或 NEW:"。
    expect(prompt).toContain("必须从下方「可用项目坐标清单」中认领坐标");
    expect(prompt).toContain("NEW:<简短中文名>");
    expect(prompt).toContain("不要发明清单外的坐标");
    expect(prompt).not.toContain("6. project 为简短项目名");
  });

  it("rejects malformed coordinates with a render failure error", () => {
    const malformed = [{ areaNumber: 30, areaName: "考公", projectNumber: 1 }] as unknown as CoordinateOption[];
    expect(() => renderClassifyPrompt({
      item: baselineItem,
      summary: baselineSummary,
      coordinates: malformed
    })).toThrowError(AppError);

    try {
      renderClassifyPrompt({ item: baselineItem, summary: baselineSummary, coordinates: malformed });
    } catch (error) {
      expect((error as AppError).code).toBe("SYSTEM_PROMPT_RENDER_FAILED");
    }
  });
});
