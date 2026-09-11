import { Button, Space, Tag, Typography } from 'antd';
import { Clapperboard, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { actionState } from './batchFactoryV11State.js';
import { directorActionState, directorRevisionLabel, fixedVideoLabel } from './directorState.js';
import { useDirectorRevisionRefresh } from './DirectorRefreshContext.jsx';
import { OverrideCompatibilityDetails } from './OverrideCompatibilityDetails';

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
  const refreshDirector = useDirectorRevisionRefresh();
  const refreshAction = actionState(capabilities, 'batch.read');
  const [refreshingRevision, setRefreshingRevision] = useState(false);
  const maxDurationSeconds = Number(
    book?.modelCapability?.maxDurationSeconds ||
    book?.modelCapabilities?.maxDurationSeconds ||
    book?.maxDurationSeconds ||
    0
  );

  async function refreshRevision() {
    if (refreshAction.disabled || !refreshDirector || refreshingRevision) return false;
    setRefreshingRevision(true);
    try {
      return await refreshDirector(book);
    } finally {
      setRefreshingRevision(false);
    }
  }

  const refreshDisabled = refreshAction.disabled || typeof refreshDirector !== 'function';
  const refreshReason = refreshAction.disabled
    ? refreshAction.reason
    : (refreshDirector ? '' : '等待 Director revision 刷新接线');

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
      <Space wrap>
        <Button
          icon={<RefreshCw size={14} />}
          loading={refreshingRevision}
          disabled={refreshDisabled}
          title={refreshReason}
          onClick={refreshRevision}
        >刷新 Revision</Button>
        <Button
          type="primary"
          icon={revision?.id ? <RefreshCw size={14} /> : <Play size={14} />}
          loading={running}
          disabled={action.disabled}
          title={action.reason}
          onClick={() => onRunDirector?.(book)}
        >{revision?.id ? '重新 Director' : '开始 Director'}</Button>
      </Space>
    </div>

    <OverrideCompatibilityDetails entries={compatibilityEntries(book)} />

    {action.disabled && action.reason ? <Typography.Text type="secondary">{action.reason}</Typography.Text> : null}
  </section>;
}

export default DirectorPanel;
