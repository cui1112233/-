import { Alert, Button, Input, Space, Tag, Typography } from 'antd';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';

const { TextArea } = Input;

export function NovelSourceModule({ book = {}, onSave, hookContent = null }) {
  const [draft, setDraft] = useState(book.sourceText || '');

  useEffect(() => {
    setDraft(book.sourceText || '');
  }, [book.id, book.revision, book.sourceText]);

  return <div className="bf11-novel-source-module">
    {book.downstreamStale ? <Alert
      type="warning"
      showIcon
      message="原文已变更，下游结果需要更新"
      description="人物、场景、画面提示词和视频卡片保留当前版本，不会被自动覆盖。"
    /> : null}
    <div className="bf11-module-toolbar">
      <Space wrap><Typography.Text strong>小说原文</Typography.Text><Tag>{draft.length} 字</Tag></Space>
      <Button type="primary" icon={<Save size={14} />} disabled={!onSave || !draft.trim()} onClick={() => onSave(book, draft)}>保存原文</Button>
    </div>
    <TextArea rows={10} value={draft} onChange={event => setDraft(event.target.value)} placeholder="请输入用于当前小说生产的正文" />
    {hookContent ? <section className="bf11-module-subsection">
      <div className="bf11-module-subsection-head"><Typography.Text strong>爆款开头</Typography.Text><Tag>原文子模块</Tag></div>
      {hookContent}
    </section> : null}
  </div>;
}

export default NovelSourceModule;
