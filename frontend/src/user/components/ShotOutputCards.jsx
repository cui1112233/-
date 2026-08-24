import { Button, Checkbox, Space } from 'antd';
import { Copy } from 'lucide-react';
import { dispatchCmSelection } from '../../shared/pet/cmBridge';

export function ShotOutputCards({ cards, duration, selectedIndexes, onToggle, onToggleAll, onCopy, onCopySelected }) {
  const selectedCount = selectedIndexes.size;
  const allSelected = cards.length > 0 && selectedCount === cards.length;

  function focusShot(card, index, cardDuration) {
    dispatchCmSelection({
      type: 'shot',
      id: `shot-${index + 1}`,
      label: `分镜 ${index + 1}`,
      meta: { index, duration: cardDuration, content: card }
    });
  }

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
        return <div
          className="shot-output-card"
          key={`${index}-${card.slice(0, 24)}`}
          tabIndex={0}
          onClick={() => focusShot(card, index, cardDuration)}
          onFocus={() => focusShot(card, index, cardDuration)}
        >
          <div className="shot-output-card-header">
            <Checkbox checked={selectedIndexes.has(index)} onChange={() => onToggle(index)}>分镜 {index + 1} · {cardDuration}</Checkbox>
            <Button size="small" icon={<Copy size={15} aria-hidden="true" />} onClick={() => onCopy(card)}>复制本分镜</Button>
          </div>
          <pre className="shot-output-card-content">{card}</pre>
        </div>;
      })}
    </div>
  );
}
