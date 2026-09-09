import { Button, Checkbox, Space, Typography } from 'antd';
import { Copy, Download, Star, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';
import { collectShotReferenceDescriptors } from '../pages/scriptVideoReferences';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, onOpenVideo, output, activeMatch, cardStarts, extractInfo, shotReferenceStates, showReferenceControls = false, referenceModelKey = '', onToggleReferenceImage }) {
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
        const references = showReferenceControls ? collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index, shotReferenceStates, includeDisabled: true }) : [];
        const showReferences = showReferenceControls && references.length > 0;
        const referenceState = shotReferenceStates?.[index] || {};
        const activeReferences = showReferenceControls ? collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index, shotReferenceStates }) : [];
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              {videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={generatingIndexes.has(index) || videoTask?.status === 'processing'} disabled={!onGenerateVideo || generatingIndexes.has(index) || videoTask?.status === 'processing'} onClick={() => onGenerateVideo(card, index)}>{videoTask?.status === 'processing' ? '视频生成中' : '生成视频'}</Button>}
            </Space>
          </div>
          {showReferences ? <div className="shot-reference-controls">
            <Space size={8} wrap>
              <Typography.Text type="secondary">参考图 {activeReferences.length}/{references.length}</Typography.Text>
              <Typography.Text type="secondary">{referenceModelKey === 'minimax-h3-video' ? '蓝色星标会带入 H3，灰色不使用' : '选择 H3 生成视频时会带入蓝色星标'}</Typography.Text>
            </Space>
            <Space wrap size={[8, 4]} style={{ marginTop: 6 }}>
              {references.map(reference => {
                const disabled = new Set(Array.isArray(referenceState.disabledImageUrls) ? referenceState.disabledImageUrls : []).has(reference.url);
                const stateClass = disabled ? 'is-inactive' : 'is-active';
                return <button key={`${reference.type}-${reference.url}`} type="button" className={`shot-reference-tag ${stateClass}`} aria-pressed={!disabled} aria-label={`${disabled ? '使用' : '取消使用'}${reference.label}参考图`} title={`${disabled ? '点击使用' : '点击取消使用'}${reference.label}参考图`} onClick={() => onToggleReferenceImage?.(index, reference.url)}><Star size={14} aria-hidden="true" fill={disabled ? 'none' : 'currentColor'} /><span>{reference.label}</span></button>;
              })}
            </Space>
          </div> : null}
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
