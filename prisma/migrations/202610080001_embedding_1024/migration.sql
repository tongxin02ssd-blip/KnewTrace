-- Stop the application before applying this migration. Existing vectors are
-- derived data and cannot be cast safely from 1536 to 1024 dimensions.
DROP INDEX IF EXISTS "Chunk_embedding_hnsw_idx";

UPDATE "Chunk"
SET "embedding" = NULL
WHERE "embedding" IS NOT NULL;

ALTER TABLE "Chunk"
  ALTER COLUMN "embedding" TYPE vector(1024)
  USING NULL::vector(1024);

UPDATE "Document"
SET
  "status" = 'FAILED',
  "error" = jsonb_build_object(
    'code', 'EMBEDDING_REINDEX_REQUIRED',
    'message', 'Embedding storage changed to 1024 dimensions. Retry this document to rebuild its vectors.',
    'stage', 'Embedding',
    'retryable', true
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('EMBEDDING', 'INDEXING', 'INDEXED');

CREATE INDEX "Chunk_embedding_hnsw_idx"
  ON "Chunk" USING hnsw ("embedding" vector_cosine_ops);
