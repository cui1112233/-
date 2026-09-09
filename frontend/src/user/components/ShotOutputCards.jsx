import { Button, Checkbox, Space } from 'antd';
import { Copy, Download, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';
import { collectShotReferenceDescriptors } from '../pages/scriptVideoReferences';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, extractInfo, shotReferenceStates = {}, onToggleReferenceImages, onToggleReferenceImage, onOpenVideo, output, activeMatch, cardStarts }) {
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
        const referenceState = shotReferenceStates[index] || {};
        const referenceEnabled = referenceState.enabled !== false;
        const disabledImageUrls = new Set(Array.isArray(referenceState.disabledImageUrls) ? referenceState.disabledImageUrls : []);
        const referenceImages = collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index, shotReferenceStates, includeDisabled: true });
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              {videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={generatingIndexes.has(index) || videoTask?.status === 'processing'} disabled={!onGenerateVideo || generatingIndexes.has(index) || videoTask?.status === 'processing'} onClick={() => onGenerateVideo(card, index)}>{videoTask?.status === 'processing' ? '视频生成中' : '生成视频'}</Button>}
            </Space>
          </div>
          <div className="shot-output-card-references" aria-label={`第 ${index + 1} 条分镜参考图`}>
            <span className="shot-output-card-references-label">参考图</span>
            <Button size="small" type={referenceEnabled ? 'primary' : 'default'} aria-pressed={referenceEnabled} onClick={() => onToggleReferenceImages?.(index, !referenceEnabled)}>{referenceEnabled ? '亮' : '灭'}</Button>
            {referenceImages.length ? referenceImages.map(reference => {
              const disabled = disabledImageUrls.has(reference.url);
              return <Button key={`${reference.type}-${reference.url}`} size="small" type={disabled || !referenceEnabled ? 'default' : 'primary'} aria-pressed={!disabled && referenceEnabled} onClick={() => onToggleReferenceImage?.(index, reference.url)}>{reference.label} · {disabled || !referenceEnabled ? '灭' : '亮'}</Button>;
            }) : <span className="shot-output-card-no-references">当前镜头没有已选择的主图</span>}
          </div>
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
