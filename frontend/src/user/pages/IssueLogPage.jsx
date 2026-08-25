import { Button, Empty, List, Space, Tag, Typography, message } from 'antd';
import { Bug, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listMyErrorLogs, listNovelPanelAiDiagnostics } from '../../shared/api/client';

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function readableKind(kind) {
  if (kind === 'client.api-network') return '网络请求失败';
  if (kind === 'client.api-response') return '操作请求失败';
  if (kind === 'client.window-error') return '页面运行异常';
  if (kind === 'client.unhandledrejection') return '操作未完成';
  if (kind === 'client.batch-factory.prompt-failed') return '批量工厂 · 提示词失败';
  if (kind === 'client.batch-factory.video-failed') return '批量工厂 · 视频生成失败';
  if (kind === 'client.batch-factory.merge-failed') return '批量工厂 · 视频合并失败';
  if (kind === 'client.batch-factory.production-submit-failed') return '批量工厂 · 视频提交失败';
  return '系统记录';
}

function issueContext(entry) {
  const context = entry?.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const labels = [];
  if (context.batchId) labels.push(`批次 ${context.batchId}`);
  if (context.bookTitle) labels.push(context.bookTitle);
  if (context.bookId) labels.push(`书ID ${context.bookId}`);
  if (context.videoId !== undefined && context.videoId !== null && context.videoId !== '') labels.push(`VIDEO ${context.videoId}`);
  if (context.projectId) labels.push(`项目 #${context.projectId}`);
  if (context.taskId) labels.push(`Task #${context.taskId}`);
  if (context.providerTaskId) labels.push(`Provider ${context.providerTaskId}`);
  if (context.modelName) labels.push(context.modelName);
  return labels.length ? labels : null;
}

function diagnosticEntry(entry) {
  const status = Number.isInteger(entry.http_status) ? entry.http_status : null;
  return {
    id: `novel-panel:${entry.id}`,
    kind: 'novel-panel.ai',
    message: entry.gate_summary || '小说面板 AI 请求记录',
    at: entry.at,
    path: entry.operation ? `小说面板 / ${entry.operation}` : '小说面板',
    method: status ? `HTTP ${status}` : entry.outcome || '',
    status: null,
  };
}

export function IssueLogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadEntries() {
    setLoading(true);
    try {
      const [errorsResult, diagnosticsResult] = await Promise.allSettled([listMyErrorLogs(), listNovelPanelAiDiagnostics()]);
      if (errorsResult.status === 'rejected') throw errorsResult.reason;
      const errors = errorsResult.value;
      const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : { diagnostics: [] };
      const combined = [
        ...(Array.isArray(errors.entries) ? errors.entries : []),
        ...(Array.isArray(diagnostics.diagnostics) ? diagnostics.diagnostics.map(diagnosticEntry) : []),
      ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
      setEntries(combined);
    } catch (error) {
      message.error(error.message || '读取问题日志失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadEntries(); }, []);

  return <section className="utility-page issue-log-page">
    <div className="issue-log-heading">
      <div><Typography.Title level={3}>问题日志</Typography.Title><Typography.Paragraph>系统自动记录使用过程中的异常；批量工厂的问题会附带书ID、VIDEO、项目、任务和模型等排查上下文，但不会记录密钥或认证信息。</Typography.Paragraph></div>
      <div className="issue-log-actions">
        <Button icon={<RefreshCw size={16} aria-hidden="true" />} loading={loading} onClick={loadEntries}>刷新</Button>
      </div>
    </div>
    {entries.length ? <List className="issue-log-list" loading={loading} dataSource={entries} renderItem={entry => {
      const contextLabels = issueContext(entry);
      return <List.Item>
        <List.Item.Meta
          avatar={<span className="issue-log-icon"><Bug size={18} aria-hidden="true" /></span>}
          title={<span className="issue-log-item-title"><Tag>{readableKind(entry.kind)}</Tag><span>{entry.message}</span></span>}
          description={<Space direction="vertical" size={4}>
            <div className="issue-log-detail"><span>{formatTime(entry.at)}</span>{entry.path ? <span>{entry.path}</span> : null}{entry.method ? <span>{entry.method}{entry.status ? ` ${entry.status}` : ''}</span> : null}</div>
            {contextLabels ? <Space wrap size={[4, 4]}>{contextLabels.map(label => <Tag key={label}>{label}</Tag>)}</Space> : null}
          </Space>}
        />
      </List.Item>;
    }} /> : <Empty description={loading ? '正在读取问题日志' : '暂时没有问题日志'} />}
  </section>;
}
