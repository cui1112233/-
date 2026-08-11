import { Alert, Spin } from 'antd';
import { useState } from 'react';

export function NovelPanelPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div className="novel-panel-page">
      {loading && !error ? <div className="novel-panel-status"><Spin tip="正在加载小说面板" /></div> : null}
      {error ? <Alert className="novel-panel-error" type="error" showIcon message="小说面板加载失败" /> : null}
      <iframe
        className="novel-panel-frame"
        title="小说面板"
        src="/novel-panel/workbench"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
}
