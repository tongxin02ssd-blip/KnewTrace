import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { Prisma } from "@prisma/client";
import type { AgentState, AppError } from "../shared/types.js";
import { prisma } from "./db.js";
import { emitRunEvent } from "./events.js";
import { appError, KnowTraceError } from "./errors.js";
import { createKnowledgeSearchTool } from "./retrieval.js";
import { llmProvider, webSearchProvider } from "./providers.js";

const replace = <T>() => Annotation<T>({ reducer: (_previous, next) => next });
const append = <T>() => Annotation<T[]>({ reducer: (previous, next) => [...previous, ...next], default: () => [] });

const State = Annotation.Root({
  runId: replace<string>(),
  threadId: replace<string>(),
  knowledgeBaseId: replace<string>(),
  question: replace<string>(),
  normalizedQuestion: replace<string | undefined>(),
  status: replace<AgentState["status"]>(),
  currentNode: replace<string | undefined>(),
  retrievalRound: replace<number>(),
  retrievalQueries: append<string>(),
  evidenceIds: append<string>(),
  evidenceSufficient: replace<boolean | undefined>(),
  missingAspects: replace<string[] | undefined>(),
  evaluationSummary: replace<string | undefined>(),
  webSearchRequired: replace<boolean | undefined>(),
  webSearchApproved: replace<boolean | undefined>(),
  webSearchCount: replace<number>(),
  answerDraft: replace<string | undefined>(),
  citationIds: append<string>(),
  limits: replace<AgentState["limits"]>(),
  errorCode: replace<string | undefined>(),
  errorMessage: replace<string | undefined>(),
  failedNode: replace<string | undefined>(),
  retryable: replace<boolean | undefined>(),
});

type StateValue = typeof State.State;
type StateUpdate = Partial<StateValue>;
const checkpointer = new MemorySaver();

function safeJson<T>(text: string, stage: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new KnowTraceError({ code: "LLM_INVALID_JSON", message: `LLM returned invalid structured output during ${stage}.`, stage, retryable: true });
  }
}

async function assertActive(runId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run || run.status === "CANCELLED") {
    throw new KnowTraceError({ code: "AGENT_RUN_CANCELLED", message: "Agent run was cancelled.", stage: "Agent Runtime", retryable: false });
  }
}

async function saveState(state: StateValue, update: StateUpdate, node: string) {
  const merged = { ...state, ...update, currentNode: node };
  await prisma.agentRun.update({
    where: { id: state.runId },
    data: { currentNode: node, retrievalRound: merged.retrievalRound, state: merged as unknown as Prisma.InputJsonValue },
  });
}

function node(name: string, action: (state: StateValue) => Promise<StateUpdate>) {
  return async (state: StateValue): Promise<StateUpdate> => {
    await assertActive(state.runId);
    const started = Date.now();
    await prisma.agentRun.update({ where: { id: state.runId }, data: { currentNode: name } });
    await emitRunEvent(state.runId, "node.started", { action: name, status: "RUNNING" }, name);
    try {
      const update = await action(state);
      await saveState(state, update, name);
      await emitRunEvent(state.runId, "node.completed", { action: name, status: "COMPLETED", durationMs: Date.now() - started }, name);
      return { ...update, currentNode: name };
    } catch (error) {
      // LangGraph implements durable human-in-the-loop pauses with this control-flow error.
      // It must escape unchanged so the checkpointer can resume at the same interrupt.
      if (isGraphInterrupt(error)) throw error;
      const details = appError(error, { code: "AGENT_NODE_FAILED", message: `${name} failed.`, stage: name, retryable: true });
      if (details.code !== "AGENT_RUN_CANCELLED") await emitRunEvent(state.runId, "node.failed", { action: name, status: "FAILED", durationMs: Date.now() - started, error: details }, name);
      throw new KnowTraceError(details);
    }
  };
}

const understandQuery = node("Understand Query", async (state) => {
  const raw = await llmProvider.complete([
    { role: "system", content: "Normalize the user's question into a concise private-knowledge retrieval query. Return JSON only: {\"normalizedQuestion\":\"...\",\"retrievalQuery\":\"...\"}. Do not answer the question." },
    { role: "user", content: state.question },
  ], { json: true });
  const parsed = safeJson<{ normalizedQuestion: string; retrievalQuery: string }>(raw, "Understand Query");
  return { normalizedQuestion: parsed.normalizedQuestion, retrievalQueries: [parsed.retrievalQuery] };
});

const knowledgeSearch = node("Knowledge Search", async (state) => {
  const query = state.retrievalQueries.at(-1) ?? state.question;
  const result = await createKnowledgeSearchTool(state.runId).invoke({ knowledgeBaseId: state.knowledgeBaseId, query, topK: 6 });
  const ids = safeJson<Array<{ id: string }>>(String(result), "Knowledge Search").map((item) => item.id);
  return { evidenceIds: ids, retrievalRound: state.retrievalRound + 1 };
});

const evaluateEvidence = node("Evaluate Evidence", async (state) => {
  const evidence = await prisma.evidence.findMany({ where: { id: { in: state.evidenceIds } }, select: { id: true, title: true, excerpt: true } });
  let evaluation: { sufficient: boolean; missingAspects: string[]; summary: string };
  if (!evidence.length) {
    evaluation = { sufficient: false, missingAspects: ["No indexed private evidence was retrieved"], summary: "Private knowledge search returned no evidence." };
  } else {
    const raw = await llmProvider.complete([
      { role: "system", content: "Evaluate whether the supplied evidence can fully answer the question. Be conservative. Return JSON only: {\"sufficient\":boolean,\"missingAspects\":string[],\"summary\":string}. Never invent facts." },
      { role: "user", content: `Question:\n${state.question}\n\nEvidence:\n${evidence.map((item) => `[${item.id}] ${item.title}\n${item.excerpt}`).join("\n\n")}` },
    ], { json: true });
    evaluation = safeJson(raw, "Evaluate Evidence");
  }
  await emitRunEvent(state.runId, "evidence.evaluated", evaluation, "Evaluate Evidence");
  return { evidenceSufficient: evaluation.sufficient, missingAspects: evaluation.missingAspects, evaluationSummary: evaluation.summary };
});

const rewriteQuery = node("Rewrite Query", async (state) => {
  await emitRunEvent(state.runId, "node.retrying", { action: "Knowledge Search", reason: state.evaluationSummary, attempt: 2 }, "Rewrite Query");
  const raw = await llmProvider.complete([
    { role: "system", content: "Rewrite the retrieval query to target the missing aspects. Return JSON only: {\"retrievalQuery\":\"...\"}. Do not answer." },
    { role: "user", content: `Question: ${state.question}\nPrevious query: ${state.retrievalQueries.at(-1)}\nMissing aspects: ${(state.missingAspects ?? []).join("; ")}` },
  ], { json: true });
  const parsed = safeJson<{ retrievalQuery: string }>(raw, "Rewrite Query");
  return { retrievalQueries: [parsed.retrievalQuery] };
});

const requestWebApproval = node("Request Web Approval", async (state) => {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: state.runId }, select: { status: true } });
  const payload = {
    proposedTool: "Web Search",
    query: state.retrievalQueries.at(-1) ?? state.question,
    reason: state.evaluationSummary ?? "Private knowledge is insufficient.",
    missingAspects: state.missingAspects ?? [],
  };
  if (run.status !== "WAITING_APPROVAL") {
    await prisma.agentRun.update({ where: { id: state.runId }, data: { status: "WAITING_APPROVAL", approval: payload } });
    await emitRunEvent(state.runId, "approval.required", payload, "Request Web Approval");
  }
  const approved = interrupt(payload) as boolean;
  await prisma.agentRun.update({
    where: { id: state.runId },
    data: { status: "RUNNING", approval: { ...payload, approved, resolvedAt: new Date().toISOString() } },
  });
  await emitRunEvent(state.runId, "approval.resolved", { approved }, "Request Web Approval");
  return { status: "RUNNING", webSearchRequired: true, webSearchApproved: approved };
});

const webSearch = node("Web Search", async (state) => {
  const query = state.retrievalQueries.at(-1) ?? state.question;
  const tool = await prisma.toolExecution.create({ data: { runId: state.runId, toolName: "web_search", input: { query, maxResults: 5 } } });
  await emitRunEvent(state.runId, "tool.started", { toolExecutionId: tool.id, toolName: "web_search", inputSummary: { query } }, "Web Search");
  try {
    const results = await webSearchProvider.search(query, 5);
    const evidence = await prisma.$transaction(results.map((result) => prisma.evidence.create({
      data: { runId: state.runId, sourceType: "WEB", url: result.url, title: result.title, excerpt: result.excerpt, score: result.score, retrievalQuery: query, toolExecutionId: tool.id },
    })));
    await prisma.toolExecution.update({ where: { id: tool.id }, data: { status: "COMPLETED", completedAt: new Date(), outputSummary: `${evidence.length} web result(s)` } });
    for (const item of evidence) await emitRunEvent(state.runId, "evidence.added", { evidence: item }, "Web Search");
    await emitRunEvent(state.runId, "tool.completed", { toolExecutionId: tool.id, toolName: "web_search", outputSummary: `${evidence.length} web result(s)` }, "Web Search");
    return { evidenceIds: evidence.map((item) => item.id), webSearchCount: state.webSearchCount + 1 };
  } catch (error) {
    const details = appError(error, { code: "WEB_SEARCH_FAILED", message: "Web search failed.", stage: "Web Search", retryable: true });
    await prisma.toolExecution.update({ where: { id: tool.id }, data: { status: "FAILED", completedAt: new Date(), error: details } });
    await emitRunEvent(state.runId, "tool.failed", { toolExecutionId: tool.id, toolName: "web_search", error: details }, "Web Search");
    throw new KnowTraceError(details);
  }
});

const mergeEvidence = node("Merge Evidence", async (state) => ({ evidenceIds: [...new Set(state.evidenceIds)] }));

const generateAnswer = node("Generate Answer", async (state) => {
  await emitRunEvent(state.runId, "answer.started", {}, "Generate Answer");
  const evidence = await prisma.evidence.findMany({ where: { id: { in: state.evidenceIds } }, select: { id: true, title: true, excerpt: true, sourceType: true } });
  if (!evidence.length) {
    return { answerDraft: "The available private knowledge did not contain evidence that can answer this question. Web search was not used, so no evidence-backed answer can be provided." };
  }
  const limitation = state.evidenceSufficient || state.webSearchApproved ? "" : "The user declined web search. Explicitly state that the private evidence is incomplete.";
  const raw = await llmProvider.complete([
    { role: "system", content: `Answer only from the supplied evidence. Never use outside knowledge. Insert citations inline as [[EVIDENCE_ID]] immediately after supported claims. Use only exact IDs listed below. ${limitation}` },
    { role: "user", content: `Question:\n${state.question}\n\nEvidence:\n${evidence.map((item) => `[${item.id}] (${item.sourceType}) ${item.title}\n${item.excerpt}`).join("\n\n")}` },
  ]);
  return { answerDraft: raw.trim() };
});

const resolveCitations = node("Resolve Citations", async (state) => {
  const evidence = await prisma.evidence.findMany({ where: { id: { in: state.evidenceIds } } });
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const markerByEvidence = new Map<string, number>();
  let marker = 0;
  let answer = state.answerDraft ?? "";
  answer = answer.replace(/\[\[([^\]]+)\]\]/g, (_full, evidenceId: string) => {
    if (!byId.has(evidenceId)) return "";
    if (!markerByEvidence.has(evidenceId)) markerByEvidence.set(evidenceId, ++marker);
    return `[${markerByEvidence.get(evidenceId)}]`;
  });
  if (evidence.length && markerByEvidence.size === 0) {
    const first = evidence[0]!;
    markerByEvidence.set(first.id, 1);
    answer = `${answer}\n\n[1]`;
  }
  const assistant = await prisma.message.create({ data: { threadId: state.threadId, role: "ASSISTANT", content: answer, runId: state.runId } });
  const citations = await prisma.$transaction([...markerByEvidence].map(([evidenceId, citationMarker]) => prisma.citation.create({
    data: { runId: state.runId, messageId: assistant.id, evidenceId, marker: citationMarker },
  })));
  for (const citation of citations) await emitRunEvent(state.runId, "citation.created", { citation }, "Resolve Citations");
  for (let offset = 0; offset < answer.length; offset += 48) {
    await emitRunEvent(state.runId, "answer.delta", { delta: answer.slice(offset, offset + 48) }, "Resolve Citations", false);
  }
  await emitRunEvent(state.runId, "answer.completed", { messageId: assistant.id, answer }, "Resolve Citations");
  return { answerDraft: answer, citationIds: citations.map((item) => item.id) };
});

const workflow = new StateGraph(State)
  .addNode("understand", understandQuery)
  .addNode("knowledgeSearch", knowledgeSearch)
  .addNode("evaluate", evaluateEvidence)
  .addNode("rewrite", rewriteQuery)
  .addNode("approval", requestWebApproval)
  .addNode("webSearch", webSearch)
  .addNode("merge", mergeEvidence)
  .addNode("generate", generateAnswer)
  .addNode("citations", resolveCitations)
  .addEdge(START, "understand")
  .addEdge("understand", "knowledgeSearch")
  .addEdge("knowledgeSearch", "evaluate")
  .addConditionalEdges("evaluate", (state) => state.evidenceSufficient ? "generate" : state.retrievalRound < state.limits.maxRetrievalRounds ? "rewrite" : "approval")
  .addEdge("rewrite", "knowledgeSearch")
  .addConditionalEdges("approval", (state) => state.webSearchApproved ? "webSearch" : "generate")
  .addEdge("webSearch", "merge")
  .addEdge("merge", "generate")
  .addEdge("generate", "citations")
  .addEdge("citations", END)
  .compile({ checkpointer });

const running = new Set<string>();

async function finalizeInvocation(runId: string, invoke: () => Promise<unknown>) {
  if (running.has(runId)) return;
  running.add(runId);
  try {
    await invoke();
    const current = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (current?.status === "RUNNING") {
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "COMPLETED", currentNode: null, completedAt: new Date() } });
      await emitRunEvent(runId, "run.completed", {}, undefined);
    }
  } catch (error) {
    const details = appError(error, { code: "AGENT_RUN_FAILED", message: "Agent run failed.", stage: "Agent Runtime", retryable: true });
    const current = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (current?.status !== "CANCELLED") {
      await prisma.agentRun.update({ where: { id: runId }, data: { status: "FAILED", completedAt: new Date(), error: details as Prisma.InputJsonValue } });
      await emitRunEvent(runId, "run.failed", { error: details }, undefined);
    }
  } finally {
    running.delete(runId);
  }
}

export function startAgentRun(initial: AgentState) {
  void finalizeInvocation(initial.runId, async () => {
    await prisma.agentRun.update({ where: { id: initial.runId }, data: { status: "RUNNING" } });
    await emitRunEvent(initial.runId, "run.started", { question: initial.question });
    await workflow.invoke(initial, { configurable: { thread_id: initial.runId } });
  });
}

export function resumeAgentRun(runId: string, approved: boolean) {
  void finalizeInvocation(runId, () => workflow.invoke(new Command({ resume: approved }), { configurable: { thread_id: runId } }));
}

export async function createRun(threadId: string, question: string, parentRunId?: string) {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) throw new KnowTraceError({ code: "THREAD_NOT_FOUND", message: "Thread not found.", stage: "Create Run", retryable: false }, 404);
  const message = await prisma.message.create({ data: { threadId, role: "USER", content: question } });
  const run = await prisma.agentRun.create({ data: { threadId, knowledgeBaseId: thread.knowledgeBaseId, userMessageId: message.id, parentRunId } });
  const initial: AgentState = {
    runId: run.id, threadId, knowledgeBaseId: thread.knowledgeBaseId, question, status: "QUEUED",
    retrievalRound: 0, retrievalQueries: [], evidenceIds: [], webSearchCount: 0, citationIds: [],
    limits: { maxRetrievalRounds: 2, maxQueryRewrite: 1, maxWebSearchCalls: 1, maxToolCalls: 6 },
  };
  startAgentRun(initial);
  return run;
}
