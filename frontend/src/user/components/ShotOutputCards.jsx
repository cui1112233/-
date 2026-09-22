import { Button, Checkbox, Space } from 'antd';
import { Copy, Download, History as HistoryIcon, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';
import { collectShotReferenceDescriptors } from '../pages/scriptVideoReferences';
import { isShotVideoTaskCurrent } from '../pages/scriptShotVideoTasks';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, onGenerateVideo, generatingIndexes = new Set(), videoTasks = {}, videoTaskHistory = {}, extractInfo, shotReferenceStates, onToggleReference, onOpenVideo, onOpenVideoHistory, onEditPrompt, output, activeMatch, cardStarts }) {
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
        const historyTasks = Array.isArray(videoTaskHistory[index]) ? videoTaskHistory[index] : [];
        const videoTaskCurrent = isShotVideoTaskCurrent(videoTask, card);
        const cardDuration = card.match(/总时长[：:]\s*(\d+s)/)?.[1] || duration;
        const displayRange = getShotMatchDisplayRange(output, card, index, cardStarts[index], activeMatch);
        const highlight = splitShotTextHighlight(card, displayRange);
        const references = collectShotReferenceDescriptors({ shotText: card, extractInfo, shotIndex: index, shotReferenceStates, includeDisabled: true });
        const disabledImageUrls = new Set(shotReferenceStates?.[index]?.disabledImageUrls || []);
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            {references.length ? <div className="script-shot-preset-tags" aria-label={`分镜 ${index + 1} 参考图选择`}>
              {references.map(reference => {
                const enabled = !disabledImageUrls.has(reference.url);
                return <button type="button" className={`script-shot-preset-tag${enabled ? '' : ' is-disabled'}`} aria-pressed={enabled} title={enabled ? '点击后不使用这张参考图' : '点击后恢复使用这张参考图'} onClick={() => onToggleReference?.(index, reference.url)} key={`${reference.type}-${reference.url}`}>{reference.source === 'mention' ? '@' : ''}{reference.type === 'character' ? '人物：' : '场景：'}{reference.label}</button>;
              })}
            </div> : null}
            <Space size={8}>
              <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
              <Button size="small" onClick={() => onEditPrompt?.(index)}>编辑提示词</Button>
              {videoTaskCurrent && videoTask?.status === 'succeeded' ? <><Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>生成成功</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载</Button></> : <><Space size={8}>{videoTask?.status === 'succeeded' && videoTask.videoUrl ? <><Button size="small" icon={<Video size={15} aria-hidden="true" />} onClick={() => onOpenVideo?.(videoTask)}>查看上次视频</Button><Button size="small" icon={<Download size={15} aria-hidden="true" />} href={videoTask.videoUrl} download target="_blank" rel="noreferrer">下载上次</Button></> : null}<Button size="small" type="primary" icon={<Video size={15} aria-hidden="true" />} loading={generatingIndexes.has(index) || (videoTaskCurrent && videoTask?.status === 'processing')} disabled={!onGenerateVideo || generatingIndexes.has(index) || (videoTaskCurrent && videoTask?.status === 'processing')} title={!onGenerateVideo ? '暂无视频生成权限' : undefined} onClick={() => onGenerateVideo?.(card, index)}>{videoTaskCurrent && videoTask?.status === 'processing' ? '视频生成中' : videoTask ? '重新生成视频' : onGenerateVideo ? '生成视频' : '暂无视频权限'}</Button></Space></>}
              {historyTasks.length ? <Button size="small" icon={<HistoryIcon size={15} aria-hidden="true" />} onClick={() => onOpenVideoHistory?.(index, historyTasks)}>历史视频（{historyTasks.length}）</Button> : null}
            </Space>
          </div>
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
