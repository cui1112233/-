import { Button } from 'antd';
import { ImagePlus, Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { buildMentionAssets } from './mentionAssetMenu';

function menuStyle(anchorRect) {
  if (!anchorRect) return { display: 'none' };
  const maxLeft = Math.max(12, window.innerWidth - 336);
  return {
    position: 'fixed',
    left: Math.min(Math.max(12, anchorRect.left), maxLeft),
    top: Math.min(window.innerHeight - 12, anchorRect.bottom + 8),
    zIndex: 1200
  };
}

export function MentionAssetMenu({ target, characters, scenes, onSelect, onAddImage, onCreate }) {
  const [createMode, setCreateMode] = useState(false);
  const assets = useMemo(() => buildMentionAssets(target, characters, scenes), [target, characters, scenes]);

  useEffect(() => {
    setCreateMode(false);
  }, [target?.start, target?.end]);

  if (!target?.anchorRect || typeof document === 'undefined') return null;
  const name = target.query || '主体';
  const preventFocusLoss = event => event.preventDefault();

  return createPortal(
    <section className="mention-asset-menu" style={menuStyle(target.anchorRect)} aria-label="@资产菜单">
      {assets.length ? <div className="mention-asset-menu-label">可用资产</div> : <div className="mention-asset-menu-label">没有匹配资产</div>}
      {assets.map(asset => <button
        className="mention-asset-menu-item"
        type="button"
        key={`${asset.type}-${asset.id}`}
        onMouseDown={preventFocusLoss}
        onClick={() => asset.hasImage ? onSelect(asset) : onAddImage(asset)}
      >
        {asset.hasImage ? <img src={asset.mainImageUrl} alt={`${asset.name}主图`} /> : <span className="mention-asset-menu-image-empty"><ImagePlus size={18} /></span>}
        <span className="mention-asset-menu-item-copy">
          <strong>{asset.name}</strong>
          <small>{asset.type === 'characters' ? '人物' : '场景'} · {asset.hasImage ? '点击引用主图' : '添加图片'}</small>
        </span>
        {!asset.hasImage ? <span className="mention-asset-menu-action">添加图片</span> : null}
      </button>)}
      {createMode ? <div className="mention-asset-menu-create-options">
        <span>将“@{name}”创建为</span>
        <Button size="small" onMouseDown={preventFocusLoss} onClick={() => onCreate('characters', target.query)}>人物</Button>
        <Button size="small" onMouseDown={preventFocusLoss} onClick={() => onCreate('scenes', target.query)}>场景</Button>
      </div> : <button className="mention-asset-menu-create" type="button" onMouseDown={preventFocusLoss} onClick={() => setCreateMode(true)}>
        <Plus size={17} /> 创建主体
      </button>}
    </section>,
    document.body
  );
}
