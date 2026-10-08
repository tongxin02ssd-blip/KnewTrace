import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { KnowTraceError } from "./errors.js";
import { assertSupportedFile, deleteStoredDocument, processDocument } from "./documentPipeline.js";
import { createRun, resumeAgentRun } from "./agentRuntime.js";
import { emitRunEvent, serializeStoredEvent, subscribeToRun } from "./events.js";

export const api = Router();

function normalizeUploadFileName(fileName: string) {
  const latin1Bytes = Buffer.from(fileName, "latin1");
  const decoded = latin1Bytes.toString("utf8");
  const roundTrips = Buffer.from(decoded, "utf8").equals(latin1Bytes);
  return roundTrips ? decoded : fileName;
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, config.uploadDir),
  filename: (_request, file, callback) => {
    const fileName = normalizeUploadFileName(file.originalname);
    callback(null, `${crypto.randomUUID()}${path.extname(fileName).toLowerCase()}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new KnowTraceError({ code: "VALIDATION_ERROR", message: result.error.issues.map((issue) => issue.message).join("; "), stage: "API", retryable: false }, 400);
  return result.data;
}

api.get("/health", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ status: "ok" });
});

api.get("/knowledge-bases", async (_request, response) => {
  const items = await prisma.knowledgeBase.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true, threads: true, runs: true } } },
  });
  response.json(items);
});

api.get("/knowledge-bases/:id", async (request, response) => {
  const item = await prisma.knowledgeBase.findUnique({ where: { id: request.params.id }, include: { _count: { select: { documents: true, threads: true, runs: true } } } });
  if (!item) throw new KnowTraceError({ code: "KNOWLEDGE_BASE_NOT_FOUND", message: "Knowledge base not found.", stage: "Knowledge", retryable: false }, 404);
  response.json(item);
});

api.post("/knowledge-bases", async (request, response) => {
  const body = parse(z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional() }), request.body);
  response.status(201).json(await prisma.knowledgeBase.create({ data: body }));
});

api.delete("/knowledge-bases/:id", async (request, response) => {
  const documents = await prisma.document.findMany({ where: { knowledgeBaseId: request.params.id }, select: { storagePath: true } });
  await prisma.knowledgeBase.delete({ where: { id: request.params.id } });
  await Promise.all(documents.map((document) => fs.unlink(document.storagePath).catch(() => undefined)));
  response.status(204).end();
});

api.get("/knowledge-bases/:id/documents", async (request, response) => {
  response.json(await prisma.document.findMany({ where: { knowledgeBaseId: request.params.id }, orderBy: { createdAt: "desc" } }));
});

api.post("/knowledge-bases/:id/documents", upload.single("file"), async (request, response) => {
  if (!request.file) throw new KnowTraceError({ code: "FILE_REQUIRED", message: "A document file is required.", stage: "Upload", retryable: false }, 400);
  try {
    const fileName = normalizeUploadFileName(request.file.originalname);
    assertSupportedFile(fileName);
    const knowledgeBase = await prisma.knowledgeBase.findUnique({ where: { id: String(request.params.id) }, select: { id: true } });
    if (!knowledgeBase) throw new KnowTraceError({ code: "KNOWLEDGE_BASE_NOT_FOUND", message: "Knowledge base not found.", stage: "Upload", retryable: false }, 404);
    const document = await prisma.document.create({
      data: { knowledgeBaseId: knowledgeBase.id, fileName, fileType: path.extname(fileName).slice(1).toUpperCase(), fileSize: request.file.size, storagePath: request.file.path },
    });
    void processDocument(document.id);
    response.status(202).json(document);
  } catch (error) {
    await fs.unlink(request.file.path).catch(() => undefined);
    throw error;
  }
});

api.delete("/documents/:id", async (request, response) => {
  await deleteStoredDocument(request.params.id);
  response.status(204).end();
});

api.post("/documents/:id/retry", async (request, response) => {
  const document = await prisma.document.findUnique({ where: { id: request.params.id } });
  if (!document) throw new KnowTraceError({ code: "DOCUMENT_NOT_FOUND", message: "Document not found.", stage: "Document Retry", retryable: false }, 404);
  void processDocument(document.id);
  response.status(202).json({ id: document.id, status: "PARSING" });
});

api.get("/threads", async (request, response) => {
  const knowledgeBaseId = parse(z.string().min(1), request.query.knowledgeBaseId);
  response.json(await prisma.thread.findMany({ where: { knowledgeBaseId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { messages: true } } } }));
});

api.post("/threads", async (request, response) => {
  const body = parse(z.object({ knowledgeBaseId: z.string().min(1), title: z.string().trim().min(1).max(160).default("New conversation") }), request.body);
  response.status(201).json(await prisma.thread.create({ data: { knowledgeBaseId: body.knowledgeBaseId, title: body.title ?? "New conversation" } }));
});

api.get("/threads/:id/messages", async (request, response) => {
  response.json(await prisma.message.findMany({ where: { threadId: request.params.id }, orderBy: { createdAt: "asc" }, include: { citations: true } }));
});

api.get("/runs", async (request, response) => {
  const limit = Math.min(Number(request.query.limit) || 10, 50);
  const knowledgeBaseId = typeof request.query.knowledgeBaseId === "string" ? request.query.knowledgeBaseId : undefined;
  response.json(await prisma.agentRun.findMany({
    where: knowledgeBaseId ? { knowledgeBaseId } : undefined,
    take: limit,
    orderBy: { startedAt: "desc" },
    include: { userMessage: true, thread: { select: { title: true } }, knowledgeBase: { select: { name: true } } },
  }));
});

api.post("/runs", async (request, response) => {
  const body = parse(z.object({ threadId: z.string().min(1), question: z.string().trim().min(1).max(20_000) }), request.body);
  response.status(202).json(await createRun(body.threadId, body.question));
});

async function runSnapshot(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { userMessage: true, thread: { select: { title: true } }, knowledgeBase: { select: { name: true } } },
  });
  if (!run) throw new KnowTraceError({ code: "RUN_NOT_FOUND", message: "Agent run not found.", stage: "Run", retryable: false }, 404);
  const [events, tools, evidence, citations, messages] = await Promise.all([
    prisma.agentEvent.findMany({ where: { runId }, orderBy: { seq: "asc" } }),
    prisma.toolExecution.findMany({ where: { runId }, orderBy: { startedAt: "asc" } }),
    prisma.evidence.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, include: { document: { select: { fileName: true } }, chunk: { select: { content: true, page: true, section: true, chunkIndex: true } } } }),
    prisma.citation.findMany({ where: { runId }, orderBy: { marker: "asc" }, include: { evidence: true } }),
    prisma.message.findMany({ where: { OR: [{ id: run.userMessageId }, { runId }] }, orderBy: { createdAt: "asc" } }),
  ]);
  return { run, events: events.map(serializeStoredEvent), tools, evidence, citations, messages };
}

api.get("/runs/:id", async (request, response) => response.json(await runSnapshot(request.params.id)));

api.get("/runs/:id/events", async (request, response) => {
  const after = Number(request.query.after ?? 0);
  const events = await prisma.agentEvent.findMany({ where: { runId: request.params.id, seq: { gt: after } }, orderBy: { seq: "asc" } });
  response.json(events.map(serializeStoredEvent));
});

api.get("/runs/:id/stream", async (request, response) => {
  const runId = request.params.id;
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { id: true } });
  if (!run) throw new KnowTraceError({ code: "RUN_NOT_FOUND", message: "Agent run not found.", stage: "SSE", retryable: false }, 404);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const headerSeq = request.get("Last-Event-ID");
  const lastSeq = Number(request.query.lastSeq ?? headerSeq ?? 0);
  const missing = await prisma.agentEvent.findMany({ where: { runId, seq: { gt: Number.isFinite(lastSeq) ? lastSeq : 0 } }, orderBy: { seq: "asc" } });
  for (const event of missing) response.write(`id: ${event.seq}\ndata: ${JSON.stringify(serializeStoredEvent(event))}\n\n`);
  const unsubscribe = subscribeToRun(runId, (event) => response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
  request.on("close", () => { clearInterval(heartbeat); unsubscribe(); response.end(); });
});

api.post("/runs/:id/cancel", async (request, response) => {
  const run = await prisma.agentRun.findUnique({ where: { id: request.params.id } });
  if (!run) throw new KnowTraceError({ code: "RUN_NOT_FOUND", message: "Agent run not found.", stage: "Cancel Run", retryable: false }, 404);
  if (!["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(run.status)) throw new KnowTraceError({ code: "RUN_NOT_CANCELLABLE", message: `Run in ${run.status} state cannot be cancelled.`, stage: "Cancel Run", retryable: false }, 409);
  await prisma.agentRun.update({ where: { id: run.id }, data: { status: "CANCELLED", completedAt: new Date(), error: { code: "AGENT_RUN_CANCELLED", message: "Agent run cancelled by user.", stage: "Agent Runtime", retryable: false } } });
  await emitRunEvent(run.id, "run.cancelled", { reason: "Cancelled by user" });
  response.json({ id: run.id, status: "CANCELLED" });
});

api.post("/runs/:id/retry", async (request, response) => {
  const previous = await prisma.agentRun.findUnique({ where: { id: request.params.id }, include: { userMessage: true } });
  if (!previous) throw new KnowTraceError({ code: "RUN_NOT_FOUND", message: "Agent run not found.", stage: "Retry Run", retryable: false }, 404);
  if (!["FAILED", "CANCELLED"].includes(previous.status)) throw new KnowTraceError({ code: "RUN_NOT_RETRYABLE", message: `Run in ${previous.status} state cannot be retried.`, stage: "Retry Run", retryable: false }, 409);
  response.status(202).json(await createRun(previous.threadId, previous.userMessage.content, previous.id));
});

api.post("/runs/:id/approval", async (request, response) => {
  const body = parse(z.object({ approved: z.boolean() }), request.body);
  const run = await prisma.agentRun.findUnique({ where: { id: request.params.id } });
  if (!run) throw new KnowTraceError({ code: "RUN_NOT_FOUND", message: "Agent run not found.", stage: "Approval", retryable: false }, 404);
  if (run.status !== "WAITING_APPROVAL") throw new KnowTraceError({ code: "APPROVAL_NOT_PENDING", message: "This run is not waiting for approval.", stage: "Approval", retryable: false }, 409);
  resumeAgentRun(run.id, body.approved);
  response.status(202).json({ id: run.id, status: "RUNNING", approved: body.approved });
});
