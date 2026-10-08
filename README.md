# KnowTrace V1

KnowTrace 是一个可观察、可干预的 Agentic RAG 知识工作台。V1 实现了从真实文档解析、pgvector 私有检索、LangGraph 两轮检索与人工审批，到可追溯 Citation 的完整闭环。

项目不包含 Mock 数据，也不会在密钥缺失时伪造模型、Embedding 或 Web Search 结果。配置问题会以包含 `code / message / stage / retryable` 的明确错误呈现。

## 运行要求

- Node.js 22 或 24 LTS
- npm 10+
- PostgreSQL 16 与 pgvector 扩展（可用下方 Docker Compose 启动）
- OpenAI-compatible Chat Completions API
- Embeddings API（默认适配火山方舟多模态 Embedding，固定使用 1024 维）
- Tavily API key（只有批准 Web Search 后才会调用）

## 本地启动

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:setup
npm run dev
```

打开 <http://localhost:5173>。开发环境中 Vite 会将 `/api` 代理到 `http://localhost:3001`。

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
docker compose up -d
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

生产构建与启动：

```bash
npm run build
npm start
```

生产服务默认监听 <http://localhost:3001>，并同时提供构建后的前端静态文件。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `PORT` | API/生产站点端口，默认 `3001` |
| `CLIENT_ORIGIN` | 开发前端的 CORS origin |
| `UPLOAD_DIR` | 原始文档本地存储目录 |
| `LLM_API_KEY` | Chat Completions 密钥 |
| `LLM_BASE_URL` | OpenAI-compatible API 根路径，例如 `https://api.openai.com/v1` |
| `LLM_MODEL` | 对话模型名 |
| `EMBEDDING_PROVIDER` | `volcengine`、`openai-compatible` 或 `auto`；方舟推荐显式填写 `volcengine` |
| `EMBEDDING_API_KEY` | Embeddings 密钥 |
| `EMBEDDING_BASE_URL` | Embeddings API 根路径；方舟填写 `https://ark.cn-beijing.volces.com/api/v3` |
| `EMBEDDING_MODEL` | Embedding 模型名 |
| `EMBEDDING_DIMENSIONS` | 向量维度，当前数据库固定为 `1024` |
| `EMBEDDING_CONCURRENCY` | 方舟单文本向量请求的最大并发数，默认 `6` |
| `WEB_SEARCH_API_KEY` | Tavily API key |

火山方舟适配会请求 `/embeddings/multimodal`，并将每段文本转换为 `input: [{ type: "text", text: "..." }]`。`EMBEDDING_BASE_URL` 既可填写 API 根路径，也兼容已经带有 `/embeddings/multimodal` 的完整路径。

`EMBEDDING_DIMENSIONS` 必须保持为 `1024`，与 `Chunk.embedding vector(1024)` 一致。升级 migration 会清空旧的 1536 维向量、重建 HNSW 索引，并将相关文档标记为失败；迁移完成后在知识库页面对这些文档执行重试即可重新生成分块向量。

## 完整演示路径

1. 在 Dashboard 创建 `AI Engineering` knowledge base。
2. 打开详情页，上传 PDF、DOCX 或 Markdown。页面轮询真实持久化状态：`PARSING → CHUNKING → EMBEDDING → INDEXING → INDEXED`。
3. 打开 Workspace，新建 conversation 并提问。
4. Runtime Inspector 展示 `Understand Query → Knowledge Search → Evaluate Evidence`。证据不足时只允许一次 Query Rewrite，并执行第二轮私有检索。
5. 仍不足时 Run 进入 `WAITING_APPROVAL`。批准后 LangGraph 从 interrupt checkpoint 恢复，并且最多调用一次 Tavily；拒绝则仅使用已有私有证据并明确局限。
6. 最终答案中的引用标记只能映射到已落库 Evidence。点击引用或 Sources 项可查看 Document/Chunk/page/section 或 Web URL。
7. Run Detail 展示完整 Node timeline、Tool executions、Evidence、Approval、Citations 与结构化错误。
8. 刷新 Workspace 会先读取 Run Snapshot，再用 `lastSeq` 连接 SSE；断线后自动带序号重连并补发持久化事件。

## 核心架构

```text
PDF / DOCX / MD / TXT
  → LangChain Loader
  → RecursiveCharacterTextSplitter
  → Embedding Provider
  → PostgreSQL + pgvector
  → LangChain Retriever + knowledge_search Tool

LangGraph StateGraph
  → fixed nodes / conditional edges / one rewrite loop
  → interrupt(Web approval) / Command(resume)
  → AgentEvent persistence + SSE
  → Zustand runtime reducer
  → Observable / controllable Workspace

Citation
  → Evidence
  → Chunk
  → Document
```

后端 Provider 与业务流程分离：`LlmProvider`、`EmbeddingProvider`、`WebSearchProvider`、`RetrieverPort` 都可替换，而 Agent 流程不绑定单一 LLM/Embedding 厂商。Web Search V1 明确使用 Tavily。

## 数据与恢复边界

- Run、节点事件、Tool、Evidence、Approval、Citation、最终答案和错误均持久化。
- `answer.delta` 是临时 SSE 事件；最终答案持久化在 Message 中。
- 浏览器刷新可恢复。当前 V1 的 LangGraph checkpointer 是进程内 `MemorySaver`，因此服务进程重启后，已经处于 `WAITING_APPROVAL` 的旧 Run 不能原地 resume；可使用 Retry 创建带 `parentRunId` 的新 Run。普通已完成/失败/取消 Run 不受影响。
- V1 不含 OCR；扫描件 PDF 无可提取文本时会明确报 `DOCUMENT_EMPTY`。

## 校验命令

```bash
npm run typecheck
npm run build
```

数据库 migration 位于 `prisma/migrations`。初始化 migration 会创建 pgvector、实体与索引；`202610080001_embedding_1024` 会将向量列迁移到 1024 维并重建 HNSW cosine index。
