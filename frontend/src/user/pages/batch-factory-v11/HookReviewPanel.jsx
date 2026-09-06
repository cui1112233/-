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
  const hookReviewCapability = capabilities?.['hook.review'] || {};
  const generateState = hookActionState({
    book,
    capability: hookReviewCapability,
    connected: typeof onRunHook === 'function'
  });
  const approveState = hookActionState({
    book,
    capability: hookReviewCapability,
    action: 'approve',
    connected: typeof onApproveHook === 'function'
  });
  const text = hookText(hook);

  if (book?.mode !== 'viral') {
    return <Alert
      type="info"
      showIcon
      message="原文直转模式"
      description="当前小说不需要爆款开头；系统会直接使用服务端冻结的原文窗口。"
    />;
  }

  return <section className="bf11-director-panel" data-bf-director-panel="hook">
    <div className="bf11-director-panel-head">
      <div>
        <Space wrap>
          <Sparkles size={16} />
          <Typography.Text strong>爆款开头</Typography.Text>
          <Tag color={hook?.status === 'approved' ? 'green' : hook?.status ? 'gold' : 'default'}>{hookStatusLabel(hook)}</Tag>
        </Space>
        <Typography.Text type="secondary">爆款开头由服务端生成并保存；这里负责审核和明确批准。</Typography.Text>
      </div>
      <Space wrap>
        <Button
          icon={<RefreshCw size={14} />}
          loading={running}
          disabled={generateState.disabled}
          title={generateState.reason}
          onClick={() => onRunHook?.(book)}
        >{text ? '重新生成开头' : '生成开头'}</Button>
        <Button
          type="primary"
          icon={<Check size={14} />}
          loading={approving}
          disabled={approveState.disabled}
          title={approveState.reason}
          onClick={() => onApproveHook?.(book, hook)}
        >批准开头</Button>
      </Space>
    </div>

    {text ? <div className="bf11-hook-review-copy">
      <Typography.Paragraph>{text}</Typography.Paragraph>
      {hook?.id ? <Typography.Text type="secondary">开头记录 · {hook.id}</Typography.Text> : null}
    </div> : <Alert
      type="warning"
      showIcon
      message="尚未生成爆款开头"
      description={generateState.reason || '生成后需要人工审核并明确批准，编剧流程才会继续。'}
    />}
  </section>;
}

export default HookReviewPanel;
