CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING','PARSING','CHUNKING','EMBEDDING','INDEXING','INDEXED','FAILED');
CREATE TYPE "MessageRole" AS ENUM ('USER','ASSISTANT');
CREATE TYPE "RunStatus" AS ENUM ('QUEUED','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "ToolStatus" AS ENUM ('RUNNING','COMPLETED','FAILED','CANCELLED');
CREATE TYPE "EvidenceSourceType" AS ENUM ('KNOWLEDGE','WEB');

CREATE TABLE "KnowledgeBase" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Document" ("id" TEXT PRIMARY KEY, "knowledgeBaseId" TEXT NOT NULL REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE, "fileName" TEXT NOT NULL, "fileType" TEXT NOT NULL, "fileSize" INTEGER NOT NULL, "storagePath" TEXT NOT NULL, "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING', "pageCount" INTEGER, "chunkCount" INTEGER NOT NULL DEFAULT 0, "error" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Chunk" ("id" TEXT PRIMARY KEY, "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE CASCADE, "content" TEXT NOT NULL, "page" INTEGER, "section" TEXT, "chunkIndex" INTEGER NOT NULL, "metadata" JSONB, "embedding" vector(1536));
CREATE TABLE "Thread" ("id" TEXT PRIMARY KEY, "knowledgeBaseId" TEXT NOT NULL REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE, "title" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Message" ("id" TEXT PRIMARY KEY, "threadId" TEXT NOT NULL REFERENCES "Thread"("id") ON DELETE CASCADE, "role" "MessageRole" NOT NULL, "content" TEXT NOT NULL, "runId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "threadId" TEXT NOT NULL REFERENCES "Thread"("id") ON DELETE CASCADE, "knowledgeBaseId" TEXT NOT NULL REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE, "userMessageId" TEXT NOT NULL UNIQUE REFERENCES "Message"("id"), "parentRunId" TEXT REFERENCES "AgentRun"("id"), "status" "RunStatus" NOT NULL DEFAULT 'QUEUED', "currentNode" TEXT, "retrievalRound" INTEGER NOT NULL DEFAULT 0, "state" JSONB, "approval" JSONB, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "error" JSONB);
CREATE TABLE "AgentEvent" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE, "seq" INTEGER NOT NULL, "type" TEXT NOT NULL, "node" TEXT, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("runId","seq"));
CREATE TABLE "ToolExecution" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE, "toolName" TEXT NOT NULL, "status" "ToolStatus" NOT NULL DEFAULT 'RUNNING', "input" JSONB NOT NULL, "outputSummary" TEXT, "error" JSONB, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3));
CREATE TABLE "Evidence" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE, "sourceType" "EvidenceSourceType" NOT NULL, "documentId" TEXT REFERENCES "Document"("id") ON DELETE SET NULL, "chunkId" TEXT REFERENCES "Chunk"("id") ON DELETE SET NULL, "url" TEXT, "title" TEXT NOT NULL, "excerpt" TEXT NOT NULL, "score" DOUBLE PRECISION, "retrievalQuery" TEXT NOT NULL, "toolExecutionId" TEXT REFERENCES "ToolExecution"("id") ON DELETE SET NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Citation" ("id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "AgentRun"("id") ON DELETE CASCADE, "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE, "evidenceId" TEXT NOT NULL REFERENCES "Evidence"("id") ON DELETE CASCADE, "marker" INTEGER NOT NULL, "answerStart" INTEGER, "answerEnd" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("runId","marker"));

CREATE INDEX "Document_knowledgeBaseId_status_idx" ON "Document"("knowledgeBaseId","status");
CREATE UNIQUE INDEX "Chunk_documentId_chunkIndex_key" ON "Chunk"("documentId","chunkIndex");
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");
CREATE INDEX "Thread_knowledgeBaseId_updatedAt_idx" ON "Thread"("knowledgeBaseId","updatedAt");
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId","createdAt");
CREATE INDEX "AgentRun_threadId_startedAt_idx" ON "AgentRun"("threadId","startedAt");
CREATE INDEX "AgentRun_knowledgeBaseId_startedAt_idx" ON "AgentRun"("knowledgeBaseId","startedAt");
CREATE INDEX "AgentEvent_runId_seq_idx" ON "AgentEvent"("runId","seq");
CREATE INDEX "ToolExecution_runId_startedAt_idx" ON "ToolExecution"("runId","startedAt");
CREATE INDEX "Evidence_runId_createdAt_idx" ON "Evidence"("runId","createdAt");
CREATE INDEX "Citation_messageId_idx" ON "Citation"("messageId");
CREATE INDEX "Chunk_embedding_hnsw_idx" ON "Chunk" USING hnsw ("embedding" vector_cosine_ops);
