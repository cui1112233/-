import { Button, Checkbox, Space } from 'antd';
import { Copy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitShotTextHighlight } from './shotTextHighlight';
import { getShotMatchDisplayRange } from '../pages/scriptShotReplace';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected, output, activeMatch, cardStarts }) {
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
        const cardDuration = card.match(/总时长[：:]\s*(\d+s)/)?.[1] || duration;
        return <div className="shot-output-card" key={`${index}-${card.slice(0, 24)}`}>
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
          </div>
          <pre className="shot-output-card-content">{highlight ? <>{highlight.before}<mark className="shot-output-card-match" ref={activeMatchRef}>{highlight.highlight}</mark>{highlight.after}</> : card}</pre>
        </div>;
      })}
    </div>
  );
}
