import assert from 'node:assert/strict';
import test from 'node:test';
import { cmResponseContract, parseCmActionProposal } from './cmActionProposal.js';

test('retains a complete candidate prompt in an applyable CM action', () => {
  const content = `我已按当前空间事实整理出候选场景提示词。\n\n\`\`\`cm-actions
{"summary":"更新客厅场景","actions":[{"type":"scene.update","targetId":"scene-1","label":"应用客厅场景提示词","patch":{"场景描述":"温馨奢华的现代客厅，午后阳光穿过落地窗，米白真皮沙发与深色木质茶几形成稳定空间关系，保留舒适明亮而略带压迫的家庭氛围。","时段":"白天","氛围":"温馨但压抑"}}]}
\`\`\``;
  const parsed = parseCmActionProposal(content);

  assert.equal(parsed.text, '我已按当前空间事实整理出候选场景提示词。');
  assert.equal(parsed.proposal.actions[0].patch.场景描述.includes('温馨奢华的现代客厅'), true);
  assert.equal(parsed.proposal.actions[0].patch.时段, '白天');
});

test('tells CM to return complete, previewable prompt text instead of only an action label', () => {
  const rules = cmResponseContract(['character.update', 'scene.update', 'constraint.update']).rules.join('\n');
  assert.match(rules, /动作不能只写名称/);
  assert.match(rules, /完整“外形”或“appearance”/);
  assert.match(rules, /完整“场景描述”或“description”/);
  assert.match(rules, /value\.body 完整提示词/);
});
