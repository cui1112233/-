export const PET_SIZE = { width: 120, height: 130 };
export const OVERLAY_PADDING = 8;
export const DRAG_THRESHOLD = 8;

const finite = value => Number.isFinite(value) ? value : 0;
const coordinate = (point, key) => {
  try {
    return point && typeof point === 'object' ? finite(point[key]) : 0;
  } catch {
    return 0;
  }
};

export const didDrag = (start, point) => Math.hypot(
  coordinate(point, 'x') - coordinate(start, 'x'),
  coordinate(point, 'y') - coordinate(start, 'y')
) >= DRAG_THRESHOLD;

export function getOverlayLayout(input) {
  const viewport = (() => {
    try { return input && typeof input === 'object' ? input.viewport : null; } catch { return null; }
  })();
  const pet = (() => {
    try { return input && typeof input === 'object' ? input.pet : null; } catch { return null; }
  })();
  const viewportWidth = Math.max(0, coordinate(viewport, 'width'));
  const viewportHeight = Math.max(0, coordinate(viewport, 'height'));
  const topInset = Math.min(viewportHeight, Math.max(0, coordinate(viewport, 'topInset')));
  const petLeft = coordinate(pet, 'left');
  const petTop = coordinate(pet, 'top');
  const width = Math.max(0, Math.min(360, viewportWidth - OVERLAY_PADDING * 2));
  const height = Math.max(0, Math.min(420, viewportHeight - topInset - OVERLAY_PADDING * 2));
  const minLeft = Math.min(OVERLAY_PADDING, viewportWidth);
  const maxLeft = Math.max(minLeft, viewportWidth - width - OVERLAY_PADDING);
  const minTop = Math.min(viewportHeight, topInset + OVERLAY_PADDING);
  const maxTop = Math.max(minTop, viewportHeight - height - OVERLAY_PADDING);
  const right = petLeft + PET_SIZE.width + 12 + width <= viewportWidth - OVERLAY_PADDING;
  const left = petLeft - 12 - width >= OVERLAY_PADDING;
  const placement = right ? 'right' : left ? 'left' : 'above';
  const idealLeft = placement === 'right'
    ? petLeft + PET_SIZE.width + 12
    : placement === 'left'
      ? petLeft - width - 12
      : petLeft + (PET_SIZE.width - width) / 2;
  const idealTop = placement === 'above' ? petTop - height - 12 : petTop;

  return {
    panel: {
      placement,
      width,
      height,
      left: Math.max(minLeft, Math.min(maxLeft, idealLeft)),
      top: Math.max(minTop, Math.min(maxTop, idealTop))
    }
  };
}
