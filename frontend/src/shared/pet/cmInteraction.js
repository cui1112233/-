import { petPromptBubble, petQuickActions } from './stacky.js';

export function cmInteractionView(state, context, random) {
  return {
    bubbleText: petPromptBubble(state, context, random),
    quickActions: petQuickActions(state, context)
  };
}

export function cmDraftToApply(content, hasOutput) {
  const marker = '【修改稿】';
  const message = String(content || '');
  if (!hasOutput || !message.includes(marker)) return '';
  return message.split(marker).slice(1).join(marker).trim();
}
