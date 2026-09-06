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
    : (refreshDirector ? '' : '等待编排记录刷新接线');

  return <section className="bf11-director-panel" data-bf-director-panel="director">
    <div className="bf11-director-panel-head">
      <div>
        <Space wrap>
          <Clapperboard size={16} />
          <Typography.Text strong>编剧与分镜</Typography.Text>
          <Tag color={revision?.id ? 'blue' : 'default'}>{directorRevisionLabel(revision)}</Tag>
          {book?.fixedSingleVideo ? <Tag color="purple">{fixedVideoLabel({ maxDurationSeconds })}</Tag> : null}
        </Space>
        <Typography.Text type="secondary">人物、场景、道具、视频方案只以服务端保存结果为准。</Typography.Text>
      </div>
      <Space wrap>
        <Button
          icon={<RefreshCw size={14} />}
          loading={refreshingRevision}
          disabled={refreshDisabled}
          title={refreshReason}
          onClick={refreshRevision}
        >刷新编排记录</Button>
        <Button
          type="primary"
          icon={revision?.id ? <RefreshCw size={14} /> : <Play size={14} />}
          loading={running}
          disabled={action.disabled}
          title={action.reason}
          onClick={() => onRunDirector?.(book)}
        >{revision?.id ? '重新开启编剧' : '开启编剧'}</Button>
      </Space>
    </div>

    <OverrideCompatibilityDetails entries={compatibilityEntries(book)} />

    {action.disabled && action.reason ? <Typography.Text type="secondary">{action.reason}</Typography.Text> : null}
  </section>;
}

export default DirectorPanel;
