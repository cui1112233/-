import { normalizeCmAction } from './cmBridge.js';

const actionBlockPattern = /```cm-actions\s*([\s\S]*?)```/i;

export function parseCmActionProposal(content) {
  const source = String(content || '');
  const match = source.match(actionBlockPattern);
  if (!match) return { text: source.trim(), proposal: null };

  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { text: source.trim(), proposal: null };
  }

  const actions = (Array.isArray(parsed?.actions) ? parsed.actions : [])
    .map(normalizeCmAction)
    .filter(Boolean)
    .slice(0, 8);

  const proposal = actions.length ? {
    summary: String(parsed?.summary || '').trim().slice(0, 500),
    actions
  } : null;

  return {
    text: source.replace(match[0], '').trim(),
    proposal
  };
}

export function cmResponseContract(capabilities = []) {
  const allowed = Array.isArray(capabilities) ? capabilities.filter(Boolean) : [];
  return {
    mode: 'companion',
    rules: [
      '先用自然语言回答用户，不要假装已经修改页面。',
      '只有在当前页面能力允许且用户明确要求修改时，才提出可执行操作。',
      '可执行操作必须放在回答末尾的 ```cm-actions JSON 代码块中。',
      'JSON 结构必须是 {"summary":"修改摘要","actions":[{"type":"动作类型","targetId":"实体ID","label":"动作名称","patch":{},"payload":{}}]}。',
      '动作不能只写名称：必须在 patch/payload 内给出可直接应用的完整候选提示词。',
      '修改人物时，character.update 的 patch 必须包含完整“外形”或“appearance”，未要求变更的身份、性格与关系要保留。',
      '修改场景时，scene.update 的 patch 必须包含完整“场景描述”或“description”，并保留明确的时段、氛围与空间事实。',
      '修改约束提示词时，constraint.update 的 payload 必须带 category（baseSetup/prefix/quality/restriction/negative）和 value.body 完整提示词。',
      '不要在 JSON 之外声称操作已经执行；实际应用必须由用户点击确认。'
    ],
    allowedActions: allowed
  };
}
