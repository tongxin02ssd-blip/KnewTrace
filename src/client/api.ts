import axios from "axios";
import type { AppError, DocumentStatus, RunSnapshot, RunStatus } from "../shared/types";

export const http = axios.create({ baseURL: "/api" });

export type KnowledgeBase = {
  id: string; name: string; description?: string; createdAt: string; updatedAt: string;
  _count?: { documents: number; threads: number; runs: number };
};
export type KnowledgeDocument = {
  id: string; knowledgeBaseId: string; fileName: string; fileType: string; fileSize: number;
  status: DocumentStatus; pageCount?: number; chunkCount: number; error?: AppError; createdAt: string; updatedAt: string;
};
export type Thread = { id: string; knowledgeBaseId: string; title: string; createdAt: string; updatedAt: string; _count?: { messages: number } };
export type Message = { id: string; threadId: string; role: "USER" | "ASSISTANT"; content: string; runId?: string; createdAt: string };
export type RunSummary = {
  id: string; threadId: string; knowledgeBaseId: string; parentRunId?: string; status: RunStatus;
  currentNode?: string; retrievalRound: number; startedAt: string; completedAt?: string; error?: AppError;
  userMessage: Message; thread: { title: string }; knowledgeBase: { name: string };
};

export function errorMessage(error: unknown) {
  if (axios.isAxiosError<{ error?: AppError }>(error)) return error.response?.data?.error?.message ?? error.message;
  return error instanceof Error ? error.message : "未知错误";
}

export async function getRunSnapshot(runId: string) {
  return (await http.get<RunSnapshot>(`/runs/${runId}`)).data;
}
