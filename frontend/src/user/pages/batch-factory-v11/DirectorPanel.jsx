import { Alert, Button, Space, Tag, Typography } from 'antd';
import { Clapperboard, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  compatibilitySummary,
  directorActionState,
  directorRevisionLabel,
  fixedVideoLabel
} from './directorState.js';

function compatibilityEntries(book = {}) {
  return book?.compatibility || book?.directorRevision?.compatibility || book?.director?.compatibility || [];
}

export function DirectorPanel({
  book = {},
  capabilities = {},
  running = false,
  onRunDirector
}) {
  const revision = book?.directorRevision || book?.director || {};
  const action = directorActionState({
    book,
    capability: capabilities?.['director.run'] || {},
    connected: typeof onRunDirector === 'function'
  });
  const compatibility = compatibilitySummary(compatibilityEntries(book));
  const maxDurationSeconds = Number(
    book?.modelCapability?.maxDurationSeconds ||
    book?.modelCapabilities?.maxDurationSeconds ||
    book?.maxDurationSeconds ||
    0
  );

  return <section className="bf11-director-panel" data-bf-director-panel="director">
    <div className="bf11-director-panel-head">
      <div>
        <Space wrap>
          <Clapperboard size={16} />
          <Typography.Text strong>Director</Typography.Text>
          <Tag color={revision?.id ? 'blue' : 'default'}>{directorRevisionLabel(revision)}</Tag>
          {book?.fixedSingleVideo ? <Tag color="purple">{fixedVideoLabel({ maxDurationSeconds })}</Tag> : null}
        </Space>
        <Typography.Text type="secondary">Director 输出、VIDEO identity 与 revision 只以 Go 返回结果为准。</Typography.Text>
      </div>
      <Button
        type="primary"
        icon={revision?.id ? <RefreshCw size={14} /> : <Play size={14} />}
        loading={running}
        disabled={action.disabled}
        title={action.reason}
        onClick={() => onRunDirector?.(book)}
      >{revision?.id ? '重新 Director' : '开始 Director'}</Button>
    </div>

    {compatibility ? <Alert
      type="warning"
      showIcon
      icon={<TriangleAlert size={16} />}
      message={compatibility}
      description="旧 VIDEO 覆盖不会被静默迁移到新 VIDEO。请按服务端 compatibility 状态逐项处理。"
    /> : null}

    {action.disabled && action.reason ? <Typography.Text type="secondary">{action.reason}</Typography.Text> : null}
  </section>;
}

export default DirectorPanel;
