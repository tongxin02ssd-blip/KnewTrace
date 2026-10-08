import fs from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import { api } from "./routes.js";
import { config } from "./config.js";
import { appError, KnowTraceError } from "./errors.js";
import { prisma } from "./db.js";

await fs.mkdir(config.uploadDir, { recursive: true });

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: "2mb" }));
app.use("/api", api);

const clientDir = path.resolve("dist/client");
app.use(express.static(clientDir));
app.get("/{*path}", (_request, response, next) => {
  response.sendFile(path.join(clientDir, "index.html"), (error) => error ? next(error) : undefined);
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: { code: "UPLOAD_FAILED", message: error.message, stage: "Upload", retryable: false } });
    return;
  }
  const status = error instanceof KnowTraceError ? error.httpStatus : 500;
  response.status(status).json({ error: appError(error, { code: "INTERNAL_ERROR", message: "Internal server error.", stage: "API", retryable: false }) });
});

const server = app.listen(config.port, () => {
  console.log(`KnowTrace API listening on http://localhost:${config.port}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
