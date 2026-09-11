import { Button, Checkbox, Space } from 'antd';
import { Copy, Download, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';
import { collectShotReferenceDescriptors } from '../pages/scriptVideoReferences';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, extractInfo, onOpenVideo, output, activeMatch, cardStarts }) {
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
        const videoTask = videoTasks[index];
        const cardDuration = card.match(/总时长[：:]\s*(\d+s)/)?.[1] || duration;
        const displayRange = getShotMatchDisplayRange(output, card, index, cardStarts[index], activeMatch);
        const highlight = splitShotTextHighlight(card, displayRange);
        const references = collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index });
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            {references.length ? <div className="script-shot-preset-tags" aria-label={`分镜 ${index + 1} 已绑定预设`}>
              {references.map(reference => <span className="script-shot-preset-tag" key={`${reference.type}-${reference.url}`}>{reference.label}</span>)}
            </div> : null}
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              {videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={generatingIndexes.has(index) || videoTask?.status === 'processing'} disabled={!onGenerateVideo || generatingIndexes.has(index) || videoTask?.status === 'processing'} title={!onGenerateVideo ? '暂无视频生成权限' : undefined} onClick={() => onGenerateVideo?.(card, index)}>{videoTask?.status === 'processing' ? '视频生成中' : onGenerateVideo ? '生成视频' : '暂无视频权限'}</Button>}
            </Space>
          </div>
          {references.length ? <div className="shot-output-card-references" aria-label={`分镜 ${index + 1} 参考图`}>
            <span className="shot-output-card-references-label">参考图</span>
            {references.map(reference => <span className="shot-output-card-reference-item" key={`${reference.type}-${reference.url}`}>
              <img className="shot-output-card-reference-thumbnail" src={reference.url} alt={`${reference.label}参考图`} loading="lazy" />
              <span>{reference.label}</span>
            </span>)}
          </div> : null}
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
