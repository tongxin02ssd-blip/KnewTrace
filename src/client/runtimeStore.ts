import { create } from "zustand";
import type { AgentEvent, ConnectionStatus, RunSnapshot } from "../shared/types";
import { getRunSnapshot } from "./api";

export type NodeView = { name: string; status: string; startedAt?: string; durationMs?: number; error?: unknown };
type RuntimeState = {
  runId?: string;
  run?: Record<string, unknown>;
  nodes: NodeView[];
  tools: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  approval?: Record<string, unknown>;
  answer: string;
  events: AgentEvent[];
  connection: ConnectionStatus;
  lastSeq: number;
  loadSnapshot: (runId: string) => Promise<void>;
  applyEvent: (event: AgentEvent) => void;
  setConnection: (connection: ConnectionStatus) => void;
  reset: () => void;
};

function deriveNodes(events: AgentEvent[]) {
  const order: string[] = [];
  const map = new Map<string, NodeView>();
  for (const event of events) {
    if (!event.node || !event.type.startsWith("node.")) continue;
    if (!map.has(event.node)) order.push(event.node);
    const payload = event.payload as Record<string, unknown>;
    map.set(event.node, {
      name: event.node,
      status: event.type === "node.started" ? "RUNNING" : event.type === "node.completed" ? "COMPLETED" : event.type === "node.failed" ? "FAILED" : "RETRYING",
      startedAt: map.get(event.node)?.startedAt ?? event.timestamp,
      durationMs: typeof payload.durationMs === "number" ? payload.durationMs : map.get(event.node)?.durationMs,
      error: payload.error,
    });
  }
  return order.map((name) => map.get(name)!);
}

function answerFrom(snapshot: RunSnapshot) {
  const assistant = [...snapshot.messages].reverse().find((item) => item.role === "ASSISTANT");
  return typeof assistant?.content === "string" ? assistant.content : "";
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  nodes: [], tools: [], evidence: [], citations: [], messages: [], answer: "", events: [], connection: "DISCONNECTED", lastSeq: 0,
  loadSnapshot: async (runId) => {
    const snapshot = await getRunSnapshot(runId);
    const events = snapshot.events;
    const run = snapshot.run;
    set({
      runId, run, events, nodes: deriveNodes(events), tools: snapshot.tools, evidence: snapshot.evidence,
      citations: snapshot.citations, messages: snapshot.messages, answer: answerFrom(snapshot),
      approval: typeof run.approval === "object" && run.approval ? run.approval as Record<string, unknown> : undefined,
      lastSeq: events.at(-1)?.seq ?? 0,
    });
  },
  applyEvent: (event) => set((state) => {
    if (event.seq <= state.lastSeq) return state;
    const events = [...state.events, event];
    const payload = event.payload as Record<string, unknown>;
    const next: Partial<RuntimeState> = { events, nodes: deriveNodes(events), lastSeq: event.seq };
    if (event.type === "answer.started") next.answer = "";
    if (event.type === "answer.delta" && typeof payload.delta === "string") next.answer = state.answer + payload.delta;
    if (event.type === "answer.completed" && typeof payload.answer === "string") next.answer = payload.answer;
    if (event.type === "approval.required") next.approval = payload;
    if (event.type === "approval.resolved") next.approval = undefined;
    if (event.type.startsWith("run.")) next.run = { ...state.run, status: event.type.split(".")[1]?.toUpperCase() };
    return next;
  }),
  setConnection: (connection) => set({ connection }),
  reset: () => set({ runId: undefined, run: undefined, nodes: [], tools: [], evidence: [], citations: [], messages: [], approval: undefined, answer: "", events: [], connection: "DISCONNECTED", lastSeq: 0 }),
}));

let source: EventSource | undefined;
let reconnectTimer: number | undefined;

export async function connectRuntime(runId: string, onDurableChange?: () => void) {
  source?.close();
  window.clearTimeout(reconnectTimer);
  const store = useRuntimeStore.getState();
  if (store.runId !== runId) await store.loadSnapshot(runId);
  const open = () => {
    const state = useRuntimeStore.getState();
    state.setConnection(state.connection === "DISCONNECTED" ? "RECONNECTING" : state.connection);
    source = new EventSource(`/api/runs/${runId}/stream?lastSeq=${state.lastSeq}`);
    source.onopen = () => useRuntimeStore.getState().setConnection("CONNECTED");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      useRuntimeStore.getState().applyEvent(event);
      if (["evidence.added", "tool.completed", "citation.created", "answer.completed", "run.completed", "run.failed", "run.cancelled", "approval.required", "approval.resolved"].includes(event.type)) {
        void useRuntimeStore.getState().loadSnapshot(runId).then(onDurableChange);
      }
    };
    source.onerror = () => {
      source?.close();
      useRuntimeStore.getState().setConnection("RECONNECTING");
      reconnectTimer = window.setTimeout(open, 1500);
    };
  };
  open();
  return () => { source?.close(); window.clearTimeout(reconnectTimer); useRuntimeStore.getState().setConnection("DISCONNECTED"); };
}
