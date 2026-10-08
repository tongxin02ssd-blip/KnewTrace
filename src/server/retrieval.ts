import { BaseRetriever } from "@langchain/core/retrievers";
import { Document as LangChainDocument } from "@langchain/core/documents";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { embeddingProvider } from "./providers.js";
import { KnowTraceError, appError } from "./errors.js";
import { emitRunEvent } from "./events.js";

type SearchRow = {
  id: string;
  documentId: string;
  content: string;
  page: number | null;
  section: string | null;
  chunkIndex: number;
  fileName: string;
  score: number;
};

const vectorLiteral = (vector: number[]) => `[${vector.join(",")}]`;

export interface RetrieverPort {
  search(knowledgeBaseId: string, query: string, topK: number): Promise<SearchRow[]>;
}

export class PgVectorRetriever extends BaseRetriever implements RetrieverPort {
  lc_namespace = ["knowtrace", "retrievers", "pgvector"];
  knowledgeBaseId = "";
  topK = 6;

  async search(knowledgeBaseId: string, query: string, topK: number) {
    const [queryVector] = await embeddingProvider.embed([query], "query");
    if (!queryVector) throw new KnowTraceError({ code: "EMBEDDING_EMPTY", message: "Embedding provider returned no query vector.", stage: "Knowledge Search", retryable: true });
    return prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT c."id", c."documentId", c."content", c."page", c."section", c."chunkIndex", d."fileName",
             1 - (c."embedding" <=> ${vectorLiteral(queryVector)}::vector) AS "score"
      FROM "Chunk" c
      INNER JOIN "Document" d ON d."id" = c."documentId"
      WHERE d."knowledgeBaseId" = ${knowledgeBaseId}
        AND d."status" = 'INDEXED'::"DocumentStatus"
        AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${vectorLiteral(queryVector)}::vector
      LIMIT ${topK}
    `);
  }

  async _getRelevantDocuments(query: string) {
    const rows = await this.search(this.knowledgeBaseId, query, this.topK);
    return rows.map((row) => new LangChainDocument({ pageContent: row.content, metadata: row }));
  }
}

export const retriever: RetrieverPort = new PgVectorRetriever();

export function createKnowledgeSearchTool(runId: string) {
  return new DynamicStructuredTool({
    name: "knowledge_search",
    description: "Search indexed chunks in exactly one private KnowTrace knowledge base.",
    schema: z.object({
      knowledgeBaseId: z.string(),
      query: z.string().min(1),
      topK: z.number().int().min(1).max(12),
    }),
    func: async ({ knowledgeBaseId, query, topK }) => {
      const toolExecution = await prisma.toolExecution.create({
        data: { runId, toolName: "knowledge_search", input: { knowledgeBaseId, query, topK } },
      });
      await emitRunEvent(runId, "tool.started", { toolExecutionId: toolExecution.id, toolName: "knowledge_search", inputSummary: { query, topK } }, "Knowledge Search");
      try {
        const rows = await retriever.search(knowledgeBaseId, query, topK);
        const evidence = await prisma.$transaction(rows.map((row) => prisma.evidence.create({
          data: {
            runId,
            sourceType: "KNOWLEDGE",
            documentId: row.documentId,
            chunkId: row.id,
            title: row.fileName,
            excerpt: row.content,
            score: row.score,
            retrievalQuery: query,
            toolExecutionId: toolExecution.id,
          },
        })));
        await prisma.toolExecution.update({
          where: { id: toolExecution.id },
          data: { status: "COMPLETED", completedAt: new Date(), outputSummary: `${evidence.length} evidence item(s) found` },
        });
        for (const item of evidence) {
          await emitRunEvent(runId, "evidence.added", { evidence: item }, "Knowledge Search");
        }
        await emitRunEvent(runId, "tool.completed", { toolExecutionId: toolExecution.id, toolName: "knowledge_search", outputSummary: `${evidence.length} evidence item(s)` }, "Knowledge Search");
        return JSON.stringify(evidence.map((item) => ({ id: item.id })));
      } catch (error) {
        const details = appError(error, { code: "KNOWLEDGE_SEARCH_FAILED", message: "Private knowledge search failed.", stage: "Knowledge Search", retryable: true });
        await prisma.toolExecution.update({ where: { id: toolExecution.id }, data: { status: "FAILED", completedAt: new Date(), error: details } });
        await emitRunEvent(runId, "tool.failed", { toolExecutionId: toolExecution.id, toolName: "knowledge_search", error: details }, "Knowledge Search");
        throw new KnowTraceError(details);
      }
    },
  });
}
