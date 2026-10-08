import { useCallback, useEffect, useState } from "react";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Col, Descriptions, Empty, List, Row, Space, Spin, Table, Timeline, Typography, message } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import type { AgentEvent, AppError, RunSnapshot } from "../../shared/types";
import { errorMessage, getRunSnapshot, http } from "../api";
import { ErrorBox, SourceDrawer, StatusTag, duration, labelFor } from "../components";

type EvidenceView = { id: string; sourceType: string; title: string; excerpt: string; url?: string; document?: { fileName?: string }; chunk?: { content?: string; page?: number; section?: string; chunkIndex?: number } };
export default function RunDetail() {
  const { runId = "" } = useParams(); const navigate = useNavigate(); const [snapshot, setSnapshot] = useState<RunSnapshot>(); const [loading, setLoading] = useState(true); const [source, setSource] = useState<EvidenceView>();
  const load = useCallback(async (quiet = false) => { if (!quiet) setLoading(true); try { setSnapshot(await getRunSnapshot(runId)); } catch (error) { void message.error(errorMessage(error)); } finally { if (!quiet) setLoading(false); } }, [runId]);
  useEffect(() => { void load(); }, [load]);
  const run = snapshot?.run as { id?: string; status?: string; currentNode?: string; retrievalRound?: number; startedAt?: string; completedAt?: string; error?: AppError; approval?: Record<string, unknown>; parentRunId?: string; userMessage?: { content?: string }; thread?: { title?: string }; knowledgeBase?: { name?: string } } | undefined;
  useEffect(() => { if (!run || !["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(run.status ?? "")) return; const timer = window.setInterval(() => void load(true), 1500); return () => window.clearInterval(timer); }, [run?.status, load]);
  if (loading) return <div className="center"><Spin /></div>; if (!snapshot || !run) return <Empty description="未找到运行记录" />;
  const nodeEvents = snapshot.events.filter((event) => event.type.startsWith("node.")); const answer = [...snapshot.messages].reverse().find((item) => item.role === "ASSISTANT")?.content;
  return <div className="page"><div className="page-head"><div><Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><Typography.Text className="eyebrow">运行 / {run.id}</Typography.Text><Typography.Title>执行轨迹</Typography.Title></div><Space><StatusTag status={run.status} />{["FAILED", "CANCELLED"].includes(run.status ?? "") && <Button icon={<ReloadOutlined />} onClick={async () => { const next = (await http.post<{ id: string }>(`/runs/${runId}/retry`)).data; navigate(`/runs/${next.id}`); }}>创建新运行并重试</Button>}</Space></div>
    <ErrorBox error={run.error} />
    <Row gutter={[16, 16]}>
      <Col span={24}><Card><Descriptions column={{ xs: 1, md: 3 }} items={[{ key: "kb", label: "知识库", children: run.knowledgeBase?.name }, { key: "thread", label: "对话", children: run.thread?.title }, { key: "duration", label: "耗时", children: duration(run.startedAt, run.completedAt) }, { key: "round", label: "检索轮次", children: `${run.retrievalRound ?? 0} / 2` }, { key: "node", label: "当前节点", children: labelFor(run.currentNode) }, { key: "parent", label: "父运行", children: run.parentRunId ?? "—" }]} /></Card></Col>
      <Col xs={24} xl={14}><Card title="问题"><Typography.Paragraph>{run.userMessage?.content}</Typography.Paragraph></Card><Card title="最终答案" style={{ marginTop: 16 }}><Typography.Paragraph className="answer-text">{String(answer ?? "暂无最终答案")}</Typography.Paragraph></Card></Col>
      <Col xs={24} xl={10}><Card title="节点时间线"><Timeline items={nodeEvents.map((event: AgentEvent) => ({ color: event.type === "node.failed" ? "red" : event.type === "node.completed" ? "green" : "blue", children: <div><strong>{labelFor(event.node)}</strong><br /><Typography.Text type="secondary">{labelFor(event.type)} · {new Date(event.timestamp).toLocaleTimeString()}</Typography.Text></div> }))} /></Card></Col>
      <Col span={24}><Card title="工具执行记录"><Table rowKey={(item) => String(item.id)} pagination={false} dataSource={snapshot.tools} columns={[{ title: "工具", dataIndex: "toolName", render: (value: string) => <code>{labelFor(value)}</code> }, { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag status={value} /> }, { title: "输入", dataIndex: "input", render: (value) => <code>{JSON.stringify(value)}</code> }, { title: "输出", dataIndex: "outputSummary" }, { title: "耗时", render: (_, item) => duration(String(item.startedAt), item.completedAt ? String(item.completedAt) : undefined) }]} /></Card></Col>
      <Col xs={24} xl={14}><Card title={`证据（${snapshot.evidence.length}）`}><List dataSource={snapshot.evidence as EvidenceView[]} renderItem={(item) => <List.Item className="source-item" onClick={() => setSource(item)}><List.Item.Meta title={<Space><StatusTag status={item.sourceType} />{item.title}</Space>} description={<Typography.Paragraph ellipsis={{ rows: 2 }}>{item.excerpt}</Typography.Paragraph>} /></List.Item>} /></Card></Col>
      <Col xs={24} xl={10}><Card title={`引用（${snapshot.citations.length}）`}><List dataSource={snapshot.citations} renderItem={(item) => <List.Item><List.Item.Meta title={`[${String(item.marker)}] ${String((item.evidence as Record<string, unknown>)?.title ?? "证据")}`} description={<code>{String(item.evidenceId)}</code>} /></List.Item>} /></Card>{run.approval && <Card title="审批记录" style={{ marginTop: 16 }}><pre className="json-block">{JSON.stringify(run.approval, null, 2)}</pre></Card>}</Col>
    </Row><SourceDrawer source={source} onClose={() => setSource(undefined)} />
  </div>;
}
