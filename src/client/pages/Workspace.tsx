import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckOutlined, CloseOutlined, PlusOutlined, SendOutlined, StopOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Card, Empty, Input, List, Segmented, Space, Spin, Tabs, Tag, Timeline, Typography, message } from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AppError } from "../../shared/types";
import { errorMessage, http, type KnowledgeBase, type Message, type RunSummary, type Thread } from "../api";
import { ErrorBox, SourceDrawer, StatusTag, duration, labelFor } from "../components";
import { connectRuntime, useRuntimeStore } from "../runtimeStore";

type EvidenceView = { id: string; sourceType: string; title: string; excerpt: string; url?: string; score?: number; document?: { fileName?: string }; chunk?: { content?: string; page?: number; section?: string; chunkIndex?: number } };
type CitationView = { id: string; marker: number; evidenceId: string; evidence?: EvidenceView };

function Answer({ content, citations, onSource }: { content: string; citations: CitationView[]; onSource: (source: EvidenceView) => void }) {
  const byMarker = new Map(citations.map((item) => [item.marker, item]));
  return <Typography.Paragraph className="answer-text">{content.split(/(\[\d+\])/g).map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/); const citation = match ? byMarker.get(Number(match[1])) : undefined;
    return citation?.evidence ? <button className="citation-marker" key={index} onClick={() => onSource(citation.evidence!)}>{part}</button> : <span key={index}>{part}</span>;
  })}</Typography.Paragraph>;
}

export default function Workspace() {
  const { knowledgeBaseId = "" } = useParams(); const navigate = useNavigate(); const [search, setSearch] = useSearchParams();
  const [knowledge, setKnowledge] = useState<KnowledgeBase>(); const [threads, setThreads] = useState<Thread[]>([]); const [messages, setMessages] = useState<Message[]>([]); const [selectedSource, setSelectedSource] = useState<EvidenceView>();
  const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [question, setQuestion] = useState("");
  const runtime = useRuntimeStore(); const activeThread = search.get("thread") ?? threads[0]?.id; const activeRun = search.get("run") ?? undefined;

  const loadMessages = useCallback(async (threadId?: string) => { if (!threadId) { setMessages([]); return; } try { setMessages((await http.get<Message[]>(`/threads/${threadId}/messages`)).data); } catch (error) { void message.error(errorMessage(error)); } }, []);
  const load = useCallback(async () => { setLoading(true); try { const [kb, threadData] = await Promise.all([http.get<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`), http.get<Thread[]>(`/threads?knowledgeBaseId=${knowledgeBaseId}`)]); setKnowledge(kb.data); setThreads(threadData.data); if (!search.get("thread") && threadData.data[0]) setSearch({ thread: threadData.data[0].id }, { replace: true }); } catch (error) { void message.error(errorMessage(error)); } finally { setLoading(false); } }, [knowledgeBaseId, search, setSearch]);
  useEffect(() => { void load(); }, [knowledgeBaseId]);
  useEffect(() => { void loadMessages(activeThread); }, [activeThread, loadMessages]);
  useEffect(() => { if (!activeRun) { useRuntimeStore.getState().reset(); return; } let disconnect: (() => void) | undefined; void connectRuntime(activeRun, () => void loadMessages(activeThread)).then((value) => { disconnect = value; }); return () => disconnect?.(); }, [activeRun, activeThread, loadMessages]);

  const citations = runtime.citations as CitationView[]; const evidence = runtime.evidence as EvidenceView[];
  const run = runtime.run as (Record<string, unknown> & { id?: string; status?: string; currentNode?: string; startedAt?: string; completedAt?: string; error?: AppError; parentRunId?: string }) | undefined;
  const refreshThreads = async () => setThreads((await http.get<Thread[]>(`/threads?knowledgeBaseId=${knowledgeBaseId}`)).data);
  const newThread = async () => { try { const thread = (await http.post<Thread>("/threads", { knowledgeBaseId, title: "新对话" })).data; await refreshThreads(); setSearch({ thread: thread.id }); } catch (error) { void message.error(errorMessage(error)); } };
  const send = async () => { if (!question.trim()) return; setSending(true); try { let threadId = activeThread; if (!threadId) { const thread = (await http.post<Thread>("/threads", { knowledgeBaseId, title: question.trim().slice(0, 80) })).data; threadId = thread.id; await refreshThreads(); } const created = (await http.post<RunSummary>("/runs", { threadId, question: question.trim() })).data; setQuestion(""); setSearch({ thread: threadId, run: created.id }); await loadMessages(threadId); } catch (error) { void message.error(errorMessage(error)); } finally { setSending(false); } };
  const approve = async (approved: boolean) => { if (!activeRun) return; try { await http.post(`/runs/${activeRun}/approval`, { approved }); } catch (error) { void message.error(errorMessage(error)); } };
  const cancel = async () => { if (!activeRun) return; try { await http.post(`/runs/${activeRun}/cancel`); } catch (error) { void message.error(errorMessage(error)); } };
  const retry = async () => { if (!activeRun) return; try { const next = (await http.post<RunSummary>(`/runs/${activeRun}/retry`)).data; setSearch({ thread: next.threadId, run: next.id }); } catch (error) { void message.error(errorMessage(error)); } };
  const approval = runtime.approval;
  const sourceList = useMemo(() => evidence.map((item) => ({ ...item, citation: citations.find((citation) => citation.evidenceId === item.id)?.marker })), [evidence, citations]);

  if (loading) return <div className="center"><Spin /></div>;
  return <div className="workspace-page">
    <div className="workspace-top"><div><Typography.Text className="eyebrow">智能体工作区</Typography.Text><Typography.Title level={3}>{knowledge?.name}</Typography.Title></div><Space><Badge status={runtime.connection === "CONNECTED" ? "success" : runtime.connection === "RECONNECTING" ? "warning" : "default"} text={labelFor(runtime.connection)} />{activeRun && <Button onClick={() => navigate(`/runs/${activeRun}`)}>运行详情</Button>}</Space></div>
    <div className="workspace-grid">
      <aside className="thread-panel"><div className="panel-title"><span>对话列表</span><Button size="small" type="text" icon={<PlusOutlined />} onClick={newThread} /></div><List dataSource={threads} locale={{ emptyText: "暂无对话" }} renderItem={(thread) => <List.Item className={thread.id === activeThread ? "thread active" : "thread"} onClick={() => setSearch({ thread: thread.id })}><List.Item.Meta title={thread.title} description={`${thread._count?.messages ?? 0} 条消息`} /></List.Item>} /></aside>
      <main className="conversation-panel">
        <div className="messages">{!messages.length && !runtime.answer ? <Empty description="基于当前知识库提出问题" /> : messages.map((item) => <div key={item.id} className={`message ${item.role.toLowerCase()}`}><Typography.Text className="message-role">{item.role === "USER" ? "你" : "KNOWTRACE"}</Typography.Text>{item.role === "ASSISTANT" ? <Answer content={item.content} citations={citations} onSource={setSelectedSource} /> : <Typography.Paragraph>{item.content}</Typography.Paragraph>}</div>)}
          {runtime.answer && !messages.some((item) => item.role === "ASSISTANT" && item.runId === activeRun) && <div className="message assistant streaming"><Typography.Text className="message-role">KNOWTRACE · 生成中</Typography.Text><Answer content={runtime.answer} citations={citations} onSource={setSelectedSource} /></div>}
        </div>
        <div className="composer"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="输入一个需要检索与证据支持的问题……" onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }} /><Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>运行</Button></div>
      </main>
      <aside className="runtime-panel"><div className="panel-title"><span>运行检查器</span>{run?.status && <StatusTag status={run.status} />}</div>
        {approval && run?.status === "WAITING_APPROVAL" && <Alert className="approval-card" type="warning" showIcon message="私有知识证据不足" description={<Space direction="vertical"><span><strong>建议工具：</strong> {labelFor(String(approval.proposedTool))}</span><span><strong>检索词：</strong> {String(approval.query)}</span><span><strong>原因：</strong> {String(approval.reason)}</span><Space><Button icon={<CloseOutlined />} onClick={() => approve(false)}>拒绝</Button><Button type="primary" icon={<CheckOutlined />} onClick={() => approve(true)}>批准并继续</Button></Space></Space>} />}
        {run?.error && <ErrorBox error={run.error} action={run.status === "FAILED" && <Button size="small" icon={<SyncOutlined />} onClick={retry}>重试运行</Button>} />}
        <Tabs items={[
          { key: "run", label: "运行", children: <Space direction="vertical" size="middle" style={{ width: "100%" }}><Card size="small"><div className="kv"><span>当前节点</span><strong>{labelFor(run?.currentNode)}</strong><span>检索轮次</span><strong>{String(run?.retrievalRound ?? 0)} / 2</strong><span>耗时</span><strong>{duration(run?.startedAt, run?.completedAt)}</strong></div></Card><Timeline items={runtime.nodes.map((item) => ({ color: item.status === "COMPLETED" ? "green" : item.status === "FAILED" ? "red" : "blue", children: <div><strong>{labelFor(item.name)}</strong><br /><Typography.Text type="secondary">{labelFor(item.status)}{item.durationMs ? ` · ${item.durationMs} ms` : ""}</Typography.Text></div> }))} />{["RUNNING", "WAITING_APPROVAL", "QUEUED"].includes(run?.status ?? "") && <Button danger icon={<StopOutlined />} onClick={cancel}>取消运行</Button>}</Space> },
          { key: "sources", label: `来源 ${evidence.length}`, children: <List dataSource={sourceList} locale={{ emptyText: "检索证据将在这里显示" }} renderItem={(item) => <List.Item className="source-item" onClick={() => setSelectedSource(item)}><List.Item.Meta title={<Space>{item.citation && <Tag>[{item.citation}]</Tag>}<span>{item.title}</span></Space>} description={<><StatusTag status={item.sourceType} /><Typography.Paragraph ellipsis={{ rows: 3 }}>{item.excerpt}</Typography.Paragraph></>} /></List.Item>} /> },
          { key: "tools", label: `工具 ${runtime.tools.length}`, children: <List dataSource={runtime.tools} locale={{ emptyText: "工具调用将在这里显示" }} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><code>{labelFor(String(item.toolName))}</code><StatusTag status={String(item.status)} /></Space>} description={<><div>{String(item.outputSummary ?? "运行中……")}</div><Typography.Text type="secondary">{duration(String(item.startedAt), item.completedAt ? String(item.completedAt) : undefined)}</Typography.Text></>} /></List.Item>} /> },
        ]} />
      </aside>
    </div>
    <SourceDrawer source={selectedSource} onClose={() => setSelectedSource(undefined)} />
  </div>;
}
