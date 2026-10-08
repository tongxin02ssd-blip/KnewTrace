import { Alert, Button, Drawer, Space, Tag, Typography } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import type { AppError } from "../shared/types";

export const statusColor: Record<string, string> = {
  INDEXED: "success", COMPLETED: "success", RUNNING: "processing", EMBEDDING: "processing", INDEXING: "processing",
  PARSING: "cyan", CHUNKING: "cyan", WAITING_APPROVAL: "warning", FAILED: "error", CANCELLED: "default", QUEUED: "default",
};

export const displayLabel: Record<string, string> = {
  UPLOADING: "上传中", PARSING: "解析中", CHUNKING: "分块中", EMBEDDING: "向量化中", INDEXING: "建立索引中", INDEXED: "已索引",
  QUEUED: "排队中", RUNNING: "运行中", WAITING_APPROVAL: "等待审批", COMPLETED: "已完成", FAILED: "失败", CANCELLED: "已取消", RETRYING: "重试中",
  KNOWLEDGE: "私有知识", WEB: "网页", CONNECTED: "已连接", RECONNECTING: "正在重连", DISCONNECTED: "已断开",
  "Understand Query": "理解问题", "Knowledge Search": "知识检索", "Evaluate Evidence": "评估证据", "Rewrite Query": "改写检索词",
  "Request Web Approval": "请求联网审批", "Web Search": "网页搜索", "Merge Evidence": "合并证据", "Generate Answer": "生成答案", "Resolve Citations": "解析引用",
  knowledge_search: "私有知识检索", web_search: "网页搜索",
  "node.started": "节点开始", "node.completed": "节点完成", "node.failed": "节点失败", "node.retrying": "节点重试",
};

export const labelFor = (value?: string) => value ? (displayLabel[value] ?? value) : "未知";

export function StatusTag({ status }: { status?: string }) {
  return <Tag color={statusColor[status ?? ""]}>{labelFor(status)}</Tag>;
}

export function ErrorBox({ error, action }: { error?: AppError | string; action?: ReactNode }) {
  if (!error) return null;
  const details = typeof error === "string" ? { message: error } : error;
  return <Alert type="error" showIcon message={details.message} description={"stage" in details ? `${labelFor(details.stage)} · ${details.code}${details.retryable ? " · 可重试" : ""}` : undefined} action={action} />;
}

type Source = {
  id?: string; sourceType?: string; title?: string; url?: string; excerpt?: string;
  document?: { fileName?: string }; chunk?: { content?: string; page?: number; section?: string; chunkIndex?: number };
};

export function SourceDrawer({ source, onClose }: { source?: Source; onClose: () => void }) {
  return <Drawer open={Boolean(source)} onClose={onClose} width={560} title="来源检查器">
    {source && <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div><Typography.Text type="secondary">来源类型</Typography.Text><br /><StatusTag status={source.sourceType} /></div>
      <div><Typography.Title level={4}>{source.document?.fileName ?? source.title}</Typography.Title>
        {source.sourceType === "KNOWLEDGE" && <Typography.Text type="secondary">
          页码 {source.chunk?.page ?? "—"} · 章节 {source.chunk?.section ?? "—"} · 分块 {source.chunk?.chunkIndex ?? "—"}
        </Typography.Text>}
      </div>
      <div><Typography.Text type="secondary">证据摘录</Typography.Text><div className="source-excerpt">{source.excerpt}</div></div>
      {source.chunk?.content && <div><Typography.Text type="secondary">已索引分块</Typography.Text><div className="chunk-highlight">{source.chunk.content}</div></div>}
      {source.url && <Button icon={<LinkOutlined />} href={source.url} target="_blank">打开原网页</Button>}
    </Space>}
  </Drawer>;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(started?: string, completed?: string) {
  if (!started) return "—";
  return `${Math.max(0, new Date(completed ?? Date.now()).getTime() - new Date(started).getTime())} ms`;
}
