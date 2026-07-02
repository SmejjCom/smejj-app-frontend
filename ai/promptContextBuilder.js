export function buildPromptContext({ task = "", files = [], memory = "", rag = "" } = {}) {
  return {
    task: String(task || "").slice(0, 20_000),
    files: files.slice(0, 12).map((file) => ({
      path: String(file.path || ""),
      sha256: String(file.sha256 || ""),
      content: String(file.content || "").slice(0, 80_000)
    })),
    memory: String(memory || "").slice(0, 20_000),
    rag: String(rag || "").slice(0, 40_000)
  };
}

