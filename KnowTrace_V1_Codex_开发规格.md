# KnowTrace V1 开发规格

> 目标：一次性完成一个可运行、可演示、可继续迭代的 **AI 前端 / Agentic RAG 知识工作台 MVP**。  
> 本文档是 Codex 的开发依据。除非存在无法运行的技术冲突，不要主动扩展需求。

---

## 1. 产品定位

**KnowTrace：可观察、可干预的 Agentic RAG 知识工作台。**

用户上传 PDF / DOCX / Markdown 文档建立私有知识库，提出复杂问题后，Agent 可以：

1. 检索私有知识库；
2. 判断证据是否充分；
3. 证据不足时改写 Query 并再次检索；
4. 仍不足时暂停并请求用户授权 Web Search；
5. 用户批准后继续执行；
6. 最终返回带真实 Citation 的答案；
7. 前端实时展示 Agent 当前 Node、Tool Call、Evidence、错误和执行状态。

核心价值不是“聊天”，而是：

**Agent Runtime 可观察 + Evidence 可追溯 + Human-in-the-loop 可控制。**

---

## 2. V1 边界

### 必须实现

- Knowledge Base 创建 / 删除
- PDF / DOCX / MD / TXT 上传
- 文档处理状态：Parsing → Chunking → Embedding → Indexed
- 私有 RAG
- LangChain 基础组件：Loader / Splitter / Retriever / Tool
- LangGraph：State / Node / Conditional Edge / Loop / Interrupt / Resume
- Agent Runtime SSE
- Knowledge Search Tool
- Web Search Tool
- Evidence Evaluation
- Query Rewrite，最多 1 次
- Web Search 人工批准
- Citation → Evidence → Chunk → Document 可追溯
- Source Inspector
- Run Detail
- Cancel Run
- Retry Run
- 基础错误处理与 SSE 重连

### V1 不做

- MCP
- 多 Agent
- 多租户 / 登录 / RBAC
- 团队协作
- Workflow 拖拽
- Prompt / Agent Marketplace
- OCR
- PPT / Excel / 音视频
- 长期 Memory
- 多知识库联合检索
- Node Time Travel
- 复杂统计 Dashboard

不要因为“看起来更完整”而增加以上功能。

---

## 3. 推荐技术栈

保持 TypeScript 全栈，优先降低项目复杂度。

### Frontend

- React
- TypeScript
- Vite
- React Router
- Ant Design
- Zustand
- Axios
- 原生 EventSource 或 fetch + SSE 解析

### Backend

- Node.js
- Express
- TypeScript
- LangChain JS
- LangGraph JS
- Prisma

### Storage

- PostgreSQL
- pgvector
- 本地文件存储用于原始文档

### AI Provider

抽象 LLM / Embedding Provider，不把业务代码绑定单一厂商。

通过 `.env` 配置：

```env
DATABASE_URL=
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=
EMBEDDING_MODEL=
WEB_SEARCH_API_KEY=
```

Web Search V1 可使用一个真实搜索服务，例如 Tavily。  
**不要使用 Mock 数据。** 缺少 API Key 时显示明确配置错误。

---

## 4. 页面

只实现 4 个一级页面。

### 4.1 Dashboard `/`

只负责导航：

- Knowledge Base 列表摘要
- Recent Runs
- New Knowledge Base
- Quick Ask

不要做复杂图表。

### 4.2 Knowledge `/knowledge`

- Knowledge Base 列表
- Create
- Open
- Delete

### 4.3 Knowledge Detail `/knowledge/:id`

展示：

- 文档列表
- Upload
- 文件名 / 类型 / 大小
- 当前 Pipeline 状态
- pageCount / chunkCount
- error
- Retry
- Delete

文档状态：

```text
UPLOADING
PARSING
CHUNKING
EMBEDDING
INDEXING
INDEXED
FAILED
```

未 `INDEXED` 的文档不能参与检索。

### 4.4 Agent Workspace `/workspace/:knowledgeBaseId`

三栏布局：

```text
Conversation List | Conversation | Runtime Inspector
```

中间：

- 用户问题
- Agent Answer
- Streaming Answer
- Citation Marker `[1] [2]`
- Sources

右侧 Runtime Inspector 三个 Tab：

- Run
- Sources
- Tools

必须支持：

- Cancel
- Approval
- Error / Retry
- 当前 Node
- Node Timeline
- Tool 执行状态

### 4.5 Run Detail `/runs/:runId`

展示一次 Agent Run 的完整执行记录：

- Question
- Final Answer
- Status
- Duration
- Timeline
- Tool Executions
- Evidence
- Citations
- Error

---

## 5. Source / Citation UI

最终答案中的 Citation 必须来自真实 Evidence，禁止模型凭空生成不存在的引用。

关系：

```text
Citation
→ Evidence
→ Chunk
→ Document
```

私有文档点击 Citation 后打开 Source Inspector：

- fileName
- page / section
- chunkIndex
- evidence excerpt
- 高亮对应 Chunk

Web Evidence 展示：

- title
- url
- excerpt
- Open Original

V1 不需要内嵌完整网页浏览器。

---

## 6. 核心数据实体

### KnowledgeBase

```ts
id
name
description?
createdAt
updatedAt
```

### Document

```ts
id
knowledgeBaseId
fileName
fileType
fileSize
storagePath
status
pageCount?
chunkCount
error?
createdAt
updatedAt
```

### Chunk

```ts
id
documentId
content
page?
section?
chunkIndex
metadata?
embedding
```

### Thread

```ts
id
knowledgeBaseId
title
createdAt
updatedAt
```

一个 Thread V1 只绑定一个 Knowledge Base。

### Message

```ts
id
threadId
role // USER | ASSISTANT
content
runId?
createdAt
```

### AgentRun

```ts
id
threadId
knowledgeBaseId
userMessageId
parentRunId?
status
currentNode?
retrievalRound
startedAt
completedAt?
error?
```

状态：

```text
QUEUED
RUNNING
WAITING_APPROVAL
COMPLETED
FAILED
CANCELLED
```

### AgentEvent

```ts
id
runId
seq
type
node?
payload
createdAt
```

### ToolExecution

```ts
id
runId
toolName
status
input
outputSummary?
error?
startedAt
completedAt?
```

### Evidence

```ts
id
runId
sourceType // KNOWLEDGE | WEB
documentId?
chunkId?
url?
title
excerpt
score?
retrievalQuery
toolExecutionId?
```

### Citation

```ts
id
runId
messageId
evidenceId
marker
answerStart?
answerEnd?
```

---

## 7. Agent State

LangGraph State 保存执行需要的最小状态，不要把大量文档正文复制进 State。

```ts
type AgentState = {
  runId: string
  threadId: string
  knowledgeBaseId: string

  question: string
  normalizedQuestion?: string

  status: RunStatus
  currentNode?: string

  retrievalRound: number
  retrievalQueries: string[]
  evidenceIds: string[]

  evidenceSufficient?: boolean
  missingAspects?: string[]
  evaluationSummary?: string

  webSearchRequired?: boolean
  webSearchApproved?: boolean
  webSearchCount: number

  answerDraft?: string
  citationIds: string[]

  limits: {
    maxRetrievalRounds: 2
    maxQueryRewrite: 1
    maxWebSearchCalls: 1
    maxToolCalls: 6
  }

  errorCode?: string
  errorMessage?: string
  failedNode?: string
  retryable?: boolean
}
```

---

## 8. Agent Workflow

V1 固定为：

```text
START
  ↓
Understand Query
  ↓
Knowledge Search
  ↓
Evaluate Evidence
  ├─ sufficient
  │    ↓
  │  Generate Answer
  │    ↓
  │  Resolve Citations
  │    ↓
  │   END
  │
  └─ insufficient
       ↓
   retrievalRound < 2 ?
       ├─ yes
       │   ↓
       │ Rewrite Query
       │   ↓
       │ Knowledge Search
       │   ↓
       │ Evaluate Evidence
       │
       └─ no / still insufficient
           ↓
       Request Web Approval
           ├─ Reject
           │   ↓
           │ Generate with existing evidence
           │
           └─ Approve
               ↓
             Web Search
               ↓
           Merge Evidence
               ↓
          Generate Answer
               ↓
        Resolve Citations
               ↓
              END
```

不要增加 Planner / Multi-Agent / Reflection Loop。

---

## 9. Node 责任

### Understand Query

- 规范化问题
- 生成第一次 retrieval query

### Knowledge Search

Tool：`knowledge_search`

输入：

```ts
{
  knowledgeBaseId,
  query,
  topK
}
```

输出：Evidence 列表。

### Evaluate Evidence

输出结构化结果：

```ts
{
  sufficient: boolean,
  missingAspects: string[],
  summary: string
}
```

不要使用虚假的精确百分比分数作为核心判断。

### Rewrite Query

根据：

- question
- existing evidence
- missing aspects

生成新 query。

最多 1 次。

### Web Approval

使用 LangGraph interrupt。

原因必须显示在 UI 中。

### Web Search

最多 1 次。

### Generate Answer

只允许基于 Evidence 生成答案。

证据不足时必须明确说明局限。

### Resolve Citations

Citation 必须映射到已有 Evidence。

---

## 10. Agent Event Protocol

SSE 不只是 Token Stream，而是结构化 Agent Runtime Stream。

统一 Event：

```ts
type AgentEvent = {
  eventId: string
  version: 1
  runId: string
  seq: number
  timestamp: string
  type: string
  node?: string
  payload: unknown
}
```

`seq` 必须在单个 Run 内单调递增。

### V1 Event Types

```text
run.started
run.completed
run.failed
run.cancelled

node.started
node.completed
node.failed
node.retrying

tool.started
tool.completed
tool.failed

evidence.added
evidence.evaluated

approval.required
approval.resolved

answer.started
answer.delta
answer.completed

citation.created
```

前端基于 Event 更新 Runtime State。

不要展示模型隐藏 Chain-of-Thought，只展示：

- Node
- Action
- Tool
- Input Summary
- Output Summary
- Status
- Duration

---

## 11. SSE 与恢复

前端不能只依赖当前 SSE。

页面进入 / 刷新时：

```text
GET Run Snapshot
↓
恢复 UI
↓
连接 SSE
↓
继续消费新 Event
```

前端保存 `lastSeq`。

断线后重新连接时带上 `lastSeq`，服务端尽量补发缺失事件；无法完整 Replay 时重新返回 Run Snapshot 对齐状态。

`answer.delta` 可以是临时事件，不要求逐 Token 永久保存。

持久化重点：

- Run
- Node / Tool 状态
- Evidence
- Approval
- Citation
- Final Answer
- Error

---

## 12. Human in the Loop

V1 只允许一个 Approval 场景：

**私有知识证据不足 → 是否允许 Web Search**

UI：

```text
Private knowledge is insufficient.

Proposed Tool:
Web Search

Query:
...

Reason:
...

[Reject] [Approve & Continue]
```

Approve：

```text
WAITING_APPROVAL → RUNNING
```

Reject：

使用已有 Evidence 生成答案，并说明资料不足。

---

## 13. Cancel / Retry

### Cancel

运行中可以 Cancel。

```text
RUNNING → CANCELLED
```

保留已经生成的：

- Events
- ToolExecution
- Evidence

### Retry

不要修改失败 Run。

创建新 Run：

```text
newRun.parentRunId = failedRun.id
```

保证历史可追溯。

V1 不做任意 Node 重放。

---

## 14. 前端 Runtime State

不要把 Agent 页面写成普通：

```ts
messages
loading
error
```

至少维护：

```ts
RuntimeViewState = {
  run
  nodes
  tools
  evidence
  citations
  approval
  answer
  connection
}
```

连接状态：

```text
CONNECTED
RECONNECTING
DISCONNECTED
```

建议使用 Zustand 管理 Agent Runtime，Event 通过统一 reducer / handler 更新状态。

---

## 15. 错误处理

必须覆盖并明确显示失败阶段：

- Document Parsing Failed
- Chunking Failed
- Embedding Failed
- Knowledge Search Failed
- LLM Failed
- Web Search Failed
- SSE Connection Lost
- Agent Run Failed
- Agent Run Cancelled

不要只显示 `Something went wrong`。

错误对象至少包含：

```ts
code
message
stage
retryable
```

---

## 16. API 最小集合

命名可调整，但能力必须覆盖。

### Knowledge

```text
GET    /api/knowledge-bases
POST   /api/knowledge-bases
DELETE /api/knowledge-bases/:id

GET    /api/knowledge-bases/:id/documents
POST   /api/knowledge-bases/:id/documents
DELETE /api/documents/:id
POST   /api/documents/:id/retry
```

### Thread

```text
GET  /api/threads?knowledgeBaseId=
POST /api/threads
GET  /api/threads/:id/messages
```

### Run

```text
POST /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/events
POST /api/runs/:id/cancel
POST /api/runs/:id/retry
POST /api/runs/:id/approval
```

### SSE

```text
GET /api/runs/:id/stream
```

---

## 17. 开发要求

Codex 开发时遵守：

1. 先检查现有仓库结构，有可复用代码就复用，不无意义重构。
2. TypeScript 开启严格类型。
3. 前后端共享核心 DTO / Event Type。
4. Agent、Retriever、LLM、Embedding、Web Search 做接口抽象。
5. 不允许用 Mock 数据假装功能完成。
6. API Key 缺失时给出明确配置提示。
7. 所有异步流程必须有 loading / success / error。
8. 所有长任务都必须可观察。
9. Citation 必须真实关联 Evidence。
10. 优先完成端到端闭环，再做 UI 美化。
11. UI 保持专业、简洁、偏开发者工具风格。
12. 不实现本文档之外的大型功能。
13. README 写清启动方式、环境变量和核心架构。
14. 提供 `.env.example`。
15. 提供 Prisma migration / 初始化脚本。
16. 项目应能通过一套清晰命令本地启动。

---

## 18. V1 完成标准

下面这条 Demo 完整跑通即可视为 V1 完成：

1. 创建 `AI Engineering` Knowledge Base。
2. 上传 PDF / DOCX / MD。
3. 页面实时看到 Parsing / Chunking / Embedding / Indexed。
4. 创建 Thread。
5. 提问一个无法通过单次检索完整回答的问题。
6. Runtime UI 显示：
   - Understand Query
   - Knowledge Search
   - Evidence Evaluation
   - Rewrite Query
   - Knowledge Search
7. Evidence 仍不足，Agent 进入 `WAITING_APPROVAL`。
8. 前端弹出 Web Search Approval。
9. 用户批准。
10. Agent Resume → Web Search → Generate Answer。
11. 最终答案包含真实 Citation。
12. 点击 Citation 能看到对应文档 Chunk 或 Web Evidence。
13. Run Detail 可以查看 Node、Tool、Evidence、Approval、Citation、Error。
14. 刷新页面后 Run 状态仍可恢复。
15. SSE 断线后能够重新同步。
16. Cancel 与 Retry 可正常工作。

---

## 19. 最终架构主线

整个 V1 只围绕三条主线开发：

```text
Knowledge Pipeline
      ↓
Agent Runtime
      ↓
Evidence Traceability
```

前端核心：

```text
LangGraph State
      ↓
Agent Event Stream
      ↓
SSE
      ↓
React Runtime State
      ↓
Observable / Controllable Agent UI
```

如果某个功能不能明显服务于以上主线，则不要加入 V1。
