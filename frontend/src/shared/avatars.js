export const AVATAR_PRESETS = [
  { emoji: '🚀', background: '#7c3aed', label: '火箭' },
  { emoji: '🦊', background: '#e26d5c', label: '狐狸' },
  { emoji: '🐼', background: '#3f6212', label: '熊猫' },
  { emoji: '🦁', background: '#b45309', label: '狮子' },
  { emoji: '🐯', background: '#c2410c', label: '老虎' },
  { emoji: '🐸', background: '#15803d', label: '青蛙' },
  { emoji: '🐳', background: '#0369a1', label: '鲸鱼' },
  { emoji: '🦄', background: '#a21caf', label: '独角兽' },
  { emoji: '🌙', background: '#1e3a8a', label: '月亮' },
  { emoji: '⭐', background: '#a16207', label: '星星' },
  { emoji: '⚡', background: '#78350f', label: '闪电' },
  { emoji: '🔥', background: '#9a3412', label: '火焰' },
  { emoji: '🌸', background: '#be185d', label: '花朵' },
  { emoji: '🎮', background: '#4c1d95', label: '游戏' },
  { emoji: '📚', background: '#0f766e', label: '书籍' },
  { emoji: '💎', background: '#0e7490', label: '钻石' }
];

export function avatarDisplay(avatar, username) {
  if (avatar?.emoji && avatar?.background) return avatar;
  const initial = String(username || '?').trim().charAt(0).toUpperCase() || '?';
  return { emoji: initial, background: '#f07167' };
}
