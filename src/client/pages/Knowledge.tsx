import { useEffect, useState } from "react";
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Form, Input, Modal, Popconfirm, Row, Col, Space, Spin, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import { errorMessage, http, type KnowledgeBase } from "../api";

export default function Knowledge() {
  const navigate = useNavigate();
  const [items, setItems] = useState<KnowledgeBase[]>([]); const [loading, setLoading] = useState(true); const [modal, setModal] = useState(false); const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const load = async () => { setLoading(true); try { setItems((await http.get<KnowledgeBase[]>("/knowledge-bases")).data); } catch (error) { void message.error(errorMessage(error)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async (values: { name: string; description?: string }) => { setSaving(true); try { const item = (await http.post<KnowledgeBase>("/knowledge-bases", values)).data; navigate(`/knowledge/${item.id}`); } catch (error) { void message.error(errorMessage(error)); } finally { setSaving(false); } };
  const remove = async (id: string) => { try { await http.delete(`/knowledge-bases/${id}`); await load(); } catch (error) { void message.error(errorMessage(error)); } };
  return <div className="page"><div className="page-head"><div><Typography.Text className="eyebrow">私有知识</Typography.Text><Typography.Title>知识库</Typography.Title><Typography.Paragraph type="secondary">每个对话仅绑定一个知识库，确保检索范围清晰可控。</Typography.Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>新建</Button></div>
    {loading ? <div className="center"><Spin /></div> : !items.length ? <Empty description="暂无知识库" /> : <Row gutter={[16, 16]}>{items.map((item) => <Col xs={24} md={12} xl={8} key={item.id}><Card className="kb-card" title={item.name} actions={[<Button type="text" icon={<FolderOpenOutlined />} onClick={() => navigate(`/knowledge/${item.id}`)}>打开</Button>, <Popconfirm title="确定删除这个知识库及其全部文档和运行记录吗？" onConfirm={() => remove(item.id)}><Button type="text" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>]}><Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>{item.description || "暂无描述"}</Typography.Paragraph><Space><span>{item._count?.documents ?? 0} 个文档</span><span>{item._count?.threads ?? 0} 个对话</span></Space></Card></Col>)}</Row>}
    <Modal open={modal} title="新建知识库" footer={null} onCancel={() => setModal(false)}><Form form={form} layout="vertical" onFinish={create}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="描述"><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit" loading={saving}>新建</Button></Form></Modal>
  </div>;
}
