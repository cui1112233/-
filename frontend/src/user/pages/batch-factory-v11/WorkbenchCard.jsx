import { Button, Space, Tooltip } from 'antd';
import { ChevronDown, ChevronUp, EyeOff, GripVertical, Maximize2, Minimize2, MoveDiagonal2 } from 'lucide-react';
import { ProductionMediaBoundary } from './ProductionMediaBoundary.jsx';

export function WorkbenchCard({
  id,
  title,
  subtitle,
  item,
  editMode,
  maximized,
  gridMetrics,
  onMove,
  onResize,
  onCollapse,
  onHide,
  onMaximize,
  children
}) {
  if (item.hidden) return null;

  const style = maximized
    ? { gridColumn: '1 / -1', gridRow: '1 / span 12', zIndex: 20 }
    : {
        gridColumn: `${item.x + 1} / span ${item.w}`,
        gridRow: `${item.y + 1} / span ${item.collapsed ? 1 : item.h}`
      };

  function startDrag(event) {
    if (!editMode || maximized || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = item.x;
    const originY = item.y;
    const stepX = Math.max(1, gridMetrics.columnWidth + gridMetrics.gap);
    const stepY = Math.max(1, gridMetrics.rowHeight + gridMetrics.gap);
    const move = moveEvent => onMove(
      originX + Math.round((moveEvent.clientX - startX) / stepX),
      originY + Math.round((moveEvent.clientY - startY) / stepY)
    );
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startResize(event) {
    if (!editMode || maximized || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = item.w;
    const originH = item.h;
    const stepX = Math.max(1, gridMetrics.columnWidth + gridMetrics.gap);
    const stepY = Math.max(1, gridMetrics.rowHeight + gridMetrics.gap);
    const move = moveEvent => onResize(
      originW + Math.round((moveEvent.clientX - startX) / stepX),
      originH + Math.round((moveEvent.clientY - startY) / stepY)
    );
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const cardBody = id === 'preview'
    ? <ProductionMediaBoundary>{children}</ProductionMediaBoundary>
    : children;

  return <section className={`bf11-card ${editMode ? 'is-editing' : ''} ${maximized ? 'is-maximized' : ''}`} style={style} data-bf-card={id}>
    <header className="bf11-card-head" onPointerDown={startDrag}>
      <div className="bf11-card-title">
        {editMode ? <GripVertical size={16} className="bf11-drag-icon" /> : null}
        <div>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </div>
      <Space size={2} onPointerDown={event => event.stopPropagation()}>
        <Tooltip title={item.collapsed ? '展开' : '折叠'}>
          <Button type="text" size="small" icon={item.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />} onClick={() => onCollapse(!item.collapsed)} />
        </Tooltip>
        <Tooltip title={maximized ? '退出最大化' : '最大化'}>
          <Button type="text" size="small" icon={maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />} onClick={() => onMaximize(!maximized)} />
        </Tooltip>
        {editMode ? <Tooltip title="隐藏卡片"><Button type="text" size="small" icon={<EyeOff size={15} />} onClick={onHide} /></Tooltip> : null}
      </Space>
    </header>
    {!item.collapsed ? <div className="bf11-card-body">{cardBody}</div> : null}
    {editMode && !item.collapsed && !maximized ? <button className="bf11-resize-handle" aria-label={`调整${title}大小`} onPointerDown={startResize}><MoveDiagonal2 size={15} /></button> : null}
  </section>;
}
