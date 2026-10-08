import "dotenv/config";
import path from "node:path";

export const DATABASE_EMBEDDING_DIMENSIONS = 1024;

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: number(process.env.PORT, 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./uploads"),
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL,
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER?.trim().toLowerCase() ?? "auto",
    apiKey: process.env.EMBEDDING_API_KEY,
    baseUrl: (process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.EMBEDDING_MODEL,
    dimensions: number(process.env.EMBEDDING_DIMENSIONS, DATABASE_EMBEDDING_DIMENSIONS),
    concurrency: Math.max(1, Math.floor(number(process.env.EMBEDDING_CONCURRENCY, 6))),
  },
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY,
};
