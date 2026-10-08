import { EventEmitter } from "node:events";
import type { Prisma } from "@prisma/client";
import type { AgentEvent, AgentEventType } from "../shared/types.js";
import { prisma } from "./db.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(500);
const queues = new Map<string, Promise<unknown>>();
const sequence = new Map<string, number>();

export async function emitRunEvent(runId: string, type: AgentEventType, payload: unknown, node?: string, persist = true): Promise<AgentEvent> {
  const previous = queues.get(runId) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    let lastSeq = sequence.get(runId);
    if (lastSeq === undefined) {
      const last = await prisma.agentEvent.findFirst({ where: { runId }, orderBy: { seq: "desc" }, select: { seq: true } });
      lastSeq = last?.seq ?? 0;
    }
    const nextSeq = lastSeq + 1;
    sequence.set(runId, nextSeq);
    const event: AgentEvent = {
      eventId: crypto.randomUUID(),
      version: 1,
      runId,
      seq: nextSeq,
      timestamp: new Date().toISOString(),
      type,
      ...(node ? { node } : {}),
      payload,
    };
    if (persist) {
      const stored = await prisma.agentEvent.create({
        data: { runId, seq: event.seq, type, node, payload: payload as Prisma.InputJsonValue },
      });
      event.eventId = stored.id;
      event.timestamp = stored.createdAt.toISOString();
    }
    emitter.emit(runId, event);
    return event;
  });
  queues.set(runId, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(runId) === operation) queues.delete(runId);
  }
}

export function subscribeToRun(runId: string, listener: (event: AgentEvent) => void) {
  emitter.on(runId, listener);
  return () => emitter.off(runId, listener);
}

export const serializeStoredEvent = (event: { id: string; runId: string; seq: number; type: string; node: string | null; payload: unknown; createdAt: Date }): AgentEvent => ({
  eventId: event.id,
  version: 1,
  runId: event.runId,
  seq: event.seq,
  timestamp: event.createdAt.toISOString(),
  type: event.type as AgentEventType,
  ...(event.node ? { node: event.node } : {}),
  payload: event.payload,
});
