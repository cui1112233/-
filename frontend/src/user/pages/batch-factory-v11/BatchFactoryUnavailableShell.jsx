import { Alert, Button, Space, Tag, Typography } from 'antd';

const FLOW = [
  ['01', '多本批量剧本生成', '多本任务可同时进入 Director，单本失败不应遮住其他书。'],
  ['02', 'VIDEO 画面提示词', '逐本查看并编辑每个 VIDEO 的画面提示词与最终提交预览。'],
  ['03', '视频模型', '模型来自服务端统一目录；MiniMax H3 继续使用现有托管契约。'],
  ['04', '上传 121', '生成与合并完成后进入外部发布确认流程，默认目标为 121。']
];

export function BatchFactoryUnavailableShell({ message = '', onRetry }) {
  return <div data-bf-v11-ui="degraded" style={{ maxWidth: 1180, margin: '0 auto', padding: 24 }}>
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Batch Factory V11</Typography.Title>
        <Typography.Text type="secondary">保留 V78 已验证的批量生产主链；当前仅服务端连接不可用，未切换回旧 API。</Typography.Text>
      </div>

      <Alert
        type="error"
        showIcon
        message="批量工厂服务暂时不可用"
        description={<Space direction="vertical" size={8}>
          <Typography.Text>{message || 'V11 能力接口暂时无法读取。'}</Typography.Text>
          <Typography.Text type="secondary">为避免把连接问题误认为功能被删除，工作流结构继续显示；服务恢复前不提交任何生产或发布动作。</Typography.Text>
          <div><Button type="primary" onClick={onRetry}>重新连接</Button></div>
        </Space>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {FLOW.map(([index, title, description]) => <div
          key={index}
          style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 16, minHeight: 132 }}
        >
          <Space direction="vertical" size={8}>
            <Tag>{index}</Tag>
            <Typography.Text strong>{title}</Typography.Text>
            <Typography.Text type="secondary">{description}</Typography.Text>
          </Space>
        </div>)}
      </div>

      <Typography.Text type="secondary">当前状态：只读降级展示。小说获取、共享认证、MiniMax H3 adapter 与 121 凭据逻辑均未在此页面改写。</Typography.Text>
    </Space>
  </div>;
}

export default BatchFactoryUnavailableShell;
