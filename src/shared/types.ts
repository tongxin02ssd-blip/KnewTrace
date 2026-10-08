export type DocumentStatus = "UPLOADING" | "PARSING" | "CHUNKING" | "EMBEDDING" | "INDEXING" | "INDEXED" | "FAILED";
export type RunStatus = "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ConnectionStatus = "CONNECTED" | "RECONNECTING" | "DISCONNECTED";

export type AppError = { code: string; message: string; stage: string; retryable: boolean };

export type AgentEventType =
  | "run.started" | "run.completed" | "run.failed" | "run.cancelled"
  | "node.started" | "node.completed" | "node.failed" | "node.retrying"
  | "tool.started" | "tool.completed" | "tool.failed"
  | "evidence.added" | "evidence.evaluated"
  | "approval.required" | "approval.resolved"
  | "answer.started" | "answer.delta" | "answer.completed"
  | "citation.created";

export type AgentEvent = {
  eventId: string;
  version: 1;
  runId: string;
  seq: number;
  timestamp: string;
  type: AgentEventType;
  node?: string;
  payload: unknown;
};

export type AgentState = {
  runId: string;
  threadId: string;
  knowledgeBaseId: string;
  question: string;
  normalizedQuestion?: string;
  status: RunStatus;
  currentNode?: string;
  retrievalRound: number;
  retrievalQueries: string[];
  evidenceIds: string[];
  evidenceSufficient?: boolean;
  missingAspects?: string[];
  evaluationSummary?: string;
  webSearchRequired?: boolean;
  webSearchApproved?: boolean;
  webSearchCount: number;
  answerDraft?: string;
  citationIds: string[];
  limits: { maxRetrievalRounds: 2; maxQueryRewrite: 1; maxWebSearchCalls: 1; maxToolCalls: 6 };
  errorCode?: string;
  errorMessage?: string;
  failedNode?: string;
  retryable?: boolean;
};

export type RunSnapshot = {
  run: Record<string, unknown>;
  events: AgentEvent[];
  tools: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
};
