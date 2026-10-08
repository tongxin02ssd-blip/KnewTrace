import { useCallback, useEffect, useState } from "react";
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Popconfirm, Progress, Space, Spin, Table, Typography, Upload, message } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { errorMessage, http, type KnowledgeBase, type KnowledgeDocument } from "../api";
import { ErrorBox, formatBytes, StatusTag } from "../components";

const pipeline = ["UPLOADING", "PARSING", "CHUNKING", "EMBEDDING", "INDEXING", "INDEXED"];
export default function KnowledgeDetail() {
  const { id = "" } = useParams(); const navigate = useNavigate();
  const [knowledge, setKnowledge] = useState<KnowledgeBase>(); const [documents, setDocuments] = useState<KnowledgeDocument[]>([]); const [loading, setLoading] = useState(true); const [uploading, setUploading] = useState(false);
  const load = useCallback(async (quiet = false) => { if (!quiet) setLoading(true); try { const [kb, docs] = await Promise.all([http.get<KnowledgeBase>(`/knowledge-bases/${id}`), http.get<KnowledgeDocument[]>(`/knowledge-bases/${id}/documents`)]); setKnowledge(kb.data); setDocuments(docs.data); } catch (error) { if (!quiet) void message.error(errorMessage(error)); } finally { if (!quiet) setLoading(false); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!documents.some((doc) => !["INDEXED", "FAILED"].includes(doc.status))) return; const timer = window.setInterval(() => void load(true), 1200); return () => window.clearInterval(timer); }, [documents, load]);
  if (loading) return <div className="center"><Spin /></div>;
  return <div className="page"><div className="page-head"><div><Typography.Text className="eyebrow">知识库</Typography.Text><Typography.Title>{knowledge?.name}</Typography.Title><Typography.Paragraph type="secondary">{knowledge?.description || "上传来源文档，并实时查看每个索引阶段。"}</Typography.Paragraph></div><Space><Button onClick={() => navigate(`/workspace/${id}`)}>打开工作区</Button><Upload showUploadList={false} accept=".pdf,.docx,.md,.txt" customRequest={async ({ file, onSuccess, onError }) => { setUploading(true); const form = new FormData(); form.append("file", file as File); try { await http.post(`/knowledge-bases/${id}/documents`, form); onSuccess?.({}); await load(true); } catch (error) { onError?.(error as Error); void message.error(errorMessage(error)); } finally { setUploading(false); } }}><Button type="primary" icon={<UploadOutlined />} loading={uploading}>上传文档</Button></Upload></Space></div>
    <Card title="文档" extra={<Typography.Text type="secondary">PDF · DOCX · Markdown · TXT</Typography.Text>}><Table rowKey="id" dataSource={documents} locale={{ emptyText: "尚未上传文档" }} columns={[
      { title: "文档", dataIndex: "fileName", render: (value: string, record) => <div><strong>{value}</strong><br /><Typography.Text type="secondary">{record.fileType} · {formatBytes(record.fileSize)}</Typography.Text></div> },
      { title: "处理流程", dataIndex: "status", width: 220, render: (value: string) => <div><StatusTag status={value} />{value !== "FAILED" && <Progress size="small" percent={Math.max(0, pipeline.indexOf(value)) / (pipeline.length - 1) * 100} showInfo={false} />}</div> },
      { title: "页数", dataIndex: "pageCount", render: (value?: number) => value ?? "—" }, { title: "分块数", dataIndex: "chunkCount" },
      { title: "错误", dataIndex: "error", render: (value: KnowledgeDocument["error"], record) => value ? <ErrorBox error={value} action={value.retryable && <Button size="small" icon={<ReloadOutlined />} onClick={async () => { await http.post(`/documents/${record.id}/retry`); await load(true); }}>重试</Button>} /> : "—" },
      { title: "", width: 48, render: (_, record) => <Popconfirm title="确定删除此文档及其全部索引分块吗？" onConfirm={async () => { await http.delete(`/documents/${record.id}`); await load(true); }}><Button type="text" danger icon={<DeleteOutlined />} /></Popconfirm> },
    ]} /></Card>
  </div>;
}
