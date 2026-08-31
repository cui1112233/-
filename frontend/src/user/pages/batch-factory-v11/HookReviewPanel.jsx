import { Alert, Button, Space, Tag, Typography } from 'antd';
import { Check, RefreshCw, Sparkles } from 'lucide-react';
import { hookActionState, hookStatusLabel } from './directorState.js';

function hookText(hook = {}) {
  return hook?.text || hook?.body || hook?.content || hook?.approvedText || '';
}

export function HookReviewPanel({
  book = {},
  capabilities = {},
  running = false,
  approving = false,
  onRunHook,
  onApproveHook
}) {
  const hook = book?.hook || book?.hookRevision || {};
  const generateState = hookActionState({
    book,
    capability: capabilities?.['hook.run'] || {}
  });
  const approveState = hookActionState({
    book,
    capability: capabilities?.['hook.approve'] || {},
    action: 'approve'
  });
  const text = hookText(hook);

  if (book?.mode !== 'viral') {
    return <Alert
      type="info"
      showIcon
      message="原文直转模式"
      description="当前小说不需要爆款 Hook；Director 直接使用服务端冻结的原文输入。"
    />;
  }

  return <section className="bf11-director-panel" data-bf-director-panel="hook">
    <div className="bf11-director-panel-head">
      <div>
        <Space wrap>
          <Sparkles size={16} />
          <Typography.Text strong>爆款 Hook</Typography.Text>
          <Tag color={hook?.status === 'approved' ? 'green' : hook?.status ? 'gold' : 'default'}>{hookStatusLabel(hook)}</Tag>
        </Space>
        <Typography.Text type="secondary">Hook 由 Go 生成并持久化；前端只审核和提交明确动作。</Typography.Text>
      </div>
      <Space wrap>
        <Button
          icon={<RefreshCw size={14} />}
          loading={running}
          disabled={generateState.disabled}
          title={generateState.reason}
          onClick={() => onRunHook?.(book)}
        >{text ? '重新生成 Hook' : '生成 Hook'}</Button>
        <Button
          type="primary"
          icon={<Check size={14} />}
          loading={approving}
          disabled={approveState.disabled}
          title={approveState.reason}
          onClick={() => onApproveHook?.(book, hook)}
        >批准 Hook</Button>
      </Space>
    </div>

    {text ? <div className="bf11-hook-review-copy">
      <Typography.Paragraph>{text}</Typography.Paragraph>
      {hook?.id ? <Typography.Text type="secondary">Hook Revision · {hook.id}</Typography.Text> : null}
    </div> : <Alert
      type="warning"
      showIcon
      message="尚未生成 Hook"
      description={generateState.reason || '生成后需要人工审核并明确批准，Director 才能继续。'}
    />}
  </section>;
}

export default HookReviewPanel;
