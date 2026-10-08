import { AppstoreOutlined, BookOutlined, GithubOutlined } from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Knowledge from "./pages/Knowledge";
import KnowledgeDetail from "./pages/KnowledgeDetail";
import Workspace from "./pages/Workspace";
import RunDetail from "./pages/RunDetail";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const selected = location.pathname.startsWith("/knowledge") ? "/knowledge" : "/";
  return <Layout className="app-shell">
    <Layout.Sider width={224} className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark">K</span><span><strong>KnowTrace</strong><small>智能知识工作台</small></span></Link>
      <Menu mode="inline" selectedKeys={[selected]} onClick={({ key }) => navigate(key)} items={[
        { key: "/", icon: <AppstoreOutlined />, label: "概览" },
        { key: "/knowledge", icon: <BookOutlined />, label: "知识库" },
      ]} />
      <div className="sidebar-foot"><GithubOutlined /> V1 · 可观察 RAG</div>
    </Layout.Sider>
    <Layout.Content className="main-content">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/knowledge/:id" element={<KnowledgeDetail />} />
        <Route path="/workspace/:knowledgeBaseId" element={<Workspace />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout.Content>
  </Layout>;
}

export default function App() {
  return <Typography><Shell /></Typography>;
}
