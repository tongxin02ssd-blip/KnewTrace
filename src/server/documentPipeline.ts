import fs from "node:fs/promises";
import path from "node:path";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document as LangChainDocument } from "@langchain/core/documents";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { embeddingProvider } from "./providers.js";
import { appError, KnowTraceError } from "./errors.js";

const supportedTypes = new Set([".pdf", ".docx", ".md", ".txt"]);

function loaderFor(filePath: string): { load(): Promise<LangChainDocument[]> } {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return new PDFLoader(filePath, { splitPages: true });
  if (extension === ".docx") return new DocxLoader(filePath);
  if (extension === ".md" || extension === ".txt") return new TextLoader(filePath);
  throw new KnowTraceError({ code: "UNSUPPORTED_FILE_TYPE", message: `Unsupported file type: ${extension}`, stage: "Parsing", retryable: false }, 400);
}

export function assertSupportedFile(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (!supportedTypes.has(extension)) {
    throw new KnowTraceError({ code: "UNSUPPORTED_FILE_TYPE", message: "Only PDF, DOCX, Markdown, and TXT files are supported.", stage: "Upload", retryable: false }, 400);
  }
}

function vectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}

export async function processDocument(documentId: string) {
  let stage = "Parsing";
  try {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await prisma.document.update({ where: { id: documentId }, data: { status: "PARSING", error: Prisma.DbNull } });
    const pages = await loaderFor(document.storagePath).load();
    if (!pages.length || pages.every((page) => !page.pageContent.trim())) {
      throw new KnowTraceError({ code: "DOCUMENT_EMPTY", message: "The document contains no extractable text. OCR is not supported in V1.", stage, retryable: false });
    }

    stage = "Chunking";
    await prisma.document.update({ where: { id: documentId }, data: { status: "CHUNKING", pageCount: pages.length } });
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 180 });
    const split = await splitter.splitDocuments(pages);
    if (!split.length) throw new KnowTraceError({ code: "CHUNKING_EMPTY", message: "No chunks were produced from the document.", stage, retryable: true });

    await prisma.chunk.deleteMany({ where: { documentId } });
    const chunks = await Promise.all(split.map((chunk, index) => prisma.chunk.create({
      data: {
        documentId,
        content: chunk.pageContent,
        page: typeof chunk.metadata.loc?.pageNumber === "number" ? chunk.metadata.loc.pageNumber : typeof chunk.metadata.page === "number" ? chunk.metadata.page + 1 : null,
        section: typeof chunk.metadata.section === "string" ? chunk.metadata.section : null,
        chunkIndex: index,
        metadata: chunk.metadata as Prisma.InputJsonValue,
      },
      select: { id: true, content: true },
    })));

    stage = "Embedding";
    await prisma.document.update({ where: { id: documentId }, data: { status: "EMBEDDING", chunkCount: chunks.length } });
    const batchSize = 32;
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const embeddings = await embeddingProvider.embed(batch.map((chunk) => chunk.content), "document");
      await prisma.$transaction(batch.map((chunk, index) => prisma.$executeRaw`
        UPDATE "Chunk" SET "embedding" = ${vectorLiteral(embeddings[index]!)}::vector WHERE "id" = ${chunk.id}
      `));
    }

    stage = "Indexing";
    await prisma.document.update({ where: { id: documentId }, data: { status: "INDEXING" } });
    const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Chunk" WHERE "documentId" = ${documentId} AND "embedding" IS NOT NULL
    `;
    if (Number(countRows[0]?.count ?? 0) !== chunks.length) throw new KnowTraceError({ code: "INDEX_INCOMPLETE", message: "Not all chunks were indexed.", stage, retryable: true });
    await prisma.document.update({ where: { id: documentId }, data: { status: "INDEXED", error: Prisma.DbNull } });
  } catch (error) {
    const details = appError(error, { code: `${stage.toUpperCase()}_FAILED`, message: `${stage} failed.`, stage, retryable: true });
    await prisma.document.update({ where: { id: documentId }, data: { status: "FAILED", error: details as Prisma.InputJsonValue } }).catch(() => undefined);
  }
}

export async function deleteStoredDocument(documentId: string) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return;
  await prisma.document.delete({ where: { id: documentId } });
  await fs.unlink(document.storagePath).catch(() => undefined);
}
