import { useEffect, useState } from "react";
import { ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Col, Empty, Form, Input, Modal, Row, Select, Space, Spin, Table, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import { errorMessage, http, type KnowledgeBase, type RunSummary, type Thread } from "../api";
import { StatusTag } from "../components";

export default function Dashboard() {
  const navigate = useNavigate();
  const [knowledge, setKnowledge] = useState<KnowledgeBase[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [modal, setModal] = useState(false);
  const [form] = Form.useForm();
  const [quickForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [kb, recent] = await Promise.all([http.get<KnowledgeBase[]>("/knowledge-bases"), http.get<RunSummary[]>("/runs?limit=8")]);
      setKnowledge(kb.data); setRuns(recent.data);
    } catch (error) { void message.error(errorMessage(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const createKnowledge = async (values: { name: string; description?: string }) => {
    setCreating(true);
    try { const { data } = await http.post<KnowledgeBase>("/knowledge-bases", values); setModal(false); form.resetFields(); navigate(`/knowledge/${data.id}`); }
    catch (error) { void message.error(errorMessage(error)); }
    finally { setCreating(false); }
  };
  const quickAsk = async (values: { knowledgeBaseId: string; question: string }) => {
    setCreating(true);
    try {
      const thread = (await http.post<Thread>("/threads", { knowledgeBaseId: values.knowledgeBaseId, title: values.question.slice(0, 80) })).data;
      const run = (await http.post<RunSummary>("/runs", { threadId: thread.id, question: values.question })).data;
      navigate(`/workspace/${values.knowledgeBaseId}?thread=${thread.id}&run=${run.id}`);
    } catch (error) { void message.error(errorMessage(error)); }
    finally { setCreating(false); }
  };

  if (loading) return <div className="center"><Spin /></div>;
  return <div className="page">
    <div className="page-head"><div><Typography.Text className="eyebrow">KNOWTRACE / 概览</Typography.Text><Typography.Title>知识工作台</Typography.Title><Typography.Paragraph type="secondary">管理私有知识、观察智能体运行过程，并检查每一条证据。</Typography.Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>新建知识库</Button></div>
    <Row gutter={[20, 20]}>
      <Col xs={24} xl={15}><Card title="知识库" extra={<Button type="link" onClick={() => navigate("/knowledge")}>查看全部 <ArrowRightOutlined /></Button>}>
        {knowledge.length ? <Row gutter={[12, 12]}>{knowledge.slice(0, 4).map((kb) => <Col xs={24} md={12} key={kb.id}><Card size="small" hoverable onClick={() => navigate(`/knowledge/${kb.id}`)} className="kb-card"><Typography.Title level={5}>{kb.name}</Typography.Title><Typography.Paragraph ellipsis={{ rows: 2 }} type="secondary">{kb.description || "暂无描述"}</Typography.Paragraph><Space><span>{kb._count?.documents ?? 0} 个文档</span><span>{kb._count?.runs ?? 0} 次运行</span></Space></Card></Col>)}</Row> : <Empty description="创建知识库后即可开始" />}
      </Card></Col>
      <Col xs={24} xl={9}><Card title="快速提问" className="quick-ask"><Form form={quickForm} layout="vertical" onFinish={quickAsk}><Form.Item name="knowledgeBaseId" label="知识库" rules={[{ required: true }]}><Select placeholder="选择私有知识库" options={knowledge.map((kb) => ({ value: kb.id, label: kb.name }))} /></Form.Item><Form.Item name="question" label="问题" rules={[{ required: true }]}><Input.TextArea rows={5} placeholder="提出一个需要证据支持的问题……" /></Form.Item><Button type="primary" htmlType="submit" loading={creating} block disabled={!knowledge.length}>启动智能体</Button></Form></Card></Col>
      <Col span={24}><Card title="最近运行"><Table rowKey="id" pagination={false} dataSource={runs} onRow={(record) => ({ onClick: () => navigate(`/runs/${record.id}`) })} columns={[
        { title: "问题", dataIndex: ["userMessage", "content"], ellipsis: true }, { title: "知识库", dataIndex: ["knowledgeBase", "name"] }, { title: "状态", dataIndex: "status", render: (value: string) => <StatusTag status={value} /> }, { title: "开始时间", dataIndex: "startedAt", render: (value: string) => new Date(value).toLocaleString() },
      ]} /></Card></Col>
    </Row>
    <Modal title="新建知识库" open={modal} onCancel={() => setModal(false)} footer={null}><Form form={form} layout="vertical" onFinish={createKnowledge}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如：AI 工程" /></Form.Item><Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={creating}>创建并打开</Button></Form></Modal>
  </div>;
}
