import { Button, Checkbox, Space } from 'antd';
import { Copy, Download, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';

export function ShotOutputCards({ cards, cardMeta = [], duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, onOpenVideo, output, activeMatch, cardStarts }) {
  const selectedCount = selectedIndexes.size;
  const allSelected = cards.length > 0 && selectedCount === cards.length;
  const activeMatchRef = useRef(null);

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [activeMatch]);

  return (
    <div className="shot-output-cards">
      <div className="shot-output-toolbar">
        <span>已选 {selectedCount} 条</span>
        <Space size={8}>
          <Button size="small" onClick={onToggleAll}>{allSelected ? '取消全选' : '全选'}</Button>
          <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={onCopySelected} disabled={!selectedCount}>复制已选</Button>
        </Space>
      </div>
      {cards.map((card, index) => {
        // Keep the structured parser record paired with its rendered text. This
        // works for both titled and legacy parseShotOutput cards by index.
        const meta = cardMeta[index] || {};
        const videoTask = videoTasks[index];
        const cardDuration = card.match(/总时长[：:]\s*(\d+s)/)?.[1] || duration;
        const displayRange = getShotMatchDisplayRange(output, card, index, cardStarts[index], activeMatch);
        const highlight = splitShotTextHighlight(card, displayRange);
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`} data-needs-review={meta.needsReview ? 'true' : 'false'}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            {meta.needsReview && <span className="shot-output-card-review">需要检查</span>}
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              {videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={generatingIndexes.has(index) || videoTask?.status === 'processing'} disabled={!onGenerateVideo || generatingIndexes.has(index) || videoTask?.status === 'processing'} onClick={() => onGenerateVideo(card, index, meta)}>{videoTask?.status === 'processing' ? '视频生成中' : '生成视频'}</Button>}
            </Space>
          </div>
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
