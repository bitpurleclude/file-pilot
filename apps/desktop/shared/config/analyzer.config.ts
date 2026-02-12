export const ANALYZER_CONFIG = {
  maxSnippetLength: 1200,
  maxKeywordCount: 20,
  parseConcurrency: 3,
  supportedExtensions: ["txt", "md", "pdf", "docx", "xlsx"]
} as const;
