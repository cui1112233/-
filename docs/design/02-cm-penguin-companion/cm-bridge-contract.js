// 02 · CM Penguin Companion
// Reference contract only. This file documents the proposed page/selection/action bridge.

export const CM_BRIDGE_VERSION = 1;

export const CM_ACTION_TYPES = Object.freeze({
  CHARACTER_UPDATE: 'character.update',
  CHARACTER_CREATE: 'character.create',
  CHARACTER_SET_PROTAGONIST: 'character.setProtagonist',
  SCENE_UPDATE: 'scene.update',
  SCRIPT_REPLACE: 'script.replace',
  SCRIPT_PATCH: 'script.patch',
  SHOT_UPDATE: 'shot.update',
  CONSTRAINT_BIND: 'constraint.bind',
  CONSTRAINT_UPDATE: 'constraint.update',
  ASSET_UPDATE: 'asset.update',
  SEGMENT_UPDATE: 'segment.update',
  SEGMENT_BIND_ASSET: 'segment.bindAsset',
  TTS_UPDATE: 'tts.update'
});

/**
 * Every page exposes the same four layers to CM.
 *
 * @typedef {Object} CmPageSnapshot
 * @property {number} version
 * @property {{ id?: string, name?: string, kind?: string }} project
 * @property {{ id: string, name: string, path: string, summary?: string }} page
 * @property {{ type?: string, id?: string, label?: string, data?: Object } | null} selection
 * @property {Object} context
 * @property {string[]} capabilities
 */

/**
 * Agent should return readable copy separately from executable proposals.
 * The UI must never infer an action from prose markers such as `【修改稿】`.
 *
 * @typedef {Object} CmAgentResponse
 * @property {string} message
 * @property {CmActionProposal[]} proposals
 */

/**
 * @typedef {Object} CmActionProposal
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {{ type?: string, id?: string }} target
 * @property {Object} payload
 * @property {Object} [preview]
 * @property {string[]} [effects]
 * @property {boolean} [requiresConfirmation]
 */

/**
 * Example: the user is editing 林晚 and says:
 * “她外表强势，内心没安全感；右眼下加一颗泪痣，以后生成都要保持。”
 */
export const exampleCharacterResponse = {
  message: '我会保留林晚的外在控制感，把核心改成用强势保护脆弱；泪痣作为稳定视觉特征。',
  proposals: [
    {
      id: 'proposal-character-linwan',
      type: CM_ACTION_TYPES.CHARACTER_UPDATE,
      label: '修改林晚人物设定',
      target: { type: 'character', id: 'character-id-from-page' },
      payload: {
        patch: {
          性格: '表面冷静强势，习惯掌控局面；内心缺乏安全感，对亲密关系敏感。面对周泽时更克制，更多表现为试探和嘴硬。',
          外形: '黑色齐肩短发，右眼下方一颗浅色泪痣。'
        }
      },
      preview: {
        before: { 性格: '冷静、理性、强势', 外形: '黑色长发' },
        after: {
          性格: '表面冷静强势，习惯掌控局面；内心缺乏安全感，对亲密关系敏感。面对周泽时更克制，更多表现为试探和嘴硬。',
          外形: '黑色齐肩短发，右眼下方一颗浅色泪痣。'
        }
      },
      effects: ['人物表', '后续剧本生成'],
      requiresConfirmation: true
    },
    {
      id: 'proposal-constraint-linwan',
      type: CM_ACTION_TYPES.CONSTRAINT_BIND,
      label: '保持林晚人物一致性',
      target: { type: 'character', id: 'character-id-from-page' },
      payload: {
        reference: {
          entityType: 'character',
          entityId: 'character-id-from-page',
          fields: ['外形'],
          mode: 'identity-lock'
        }
      },
      effects: ['约束设置', '图片/视频提示词组装'],
      requiresConfirmation: true
    }
  ]
};

/**
 * Minimal page adapter shape.
 * Each feature area owns its data and mutation code. CM only proposes actions.
 */
export function defineCmPageBridge({ getSnapshot, applyAction, previewAction, undoAction }) {
  if (typeof getSnapshot !== 'function') throw new TypeError('getSnapshot is required');
  if (typeof applyAction !== 'function') throw new TypeError('applyAction is required');
  return Object.freeze({
    version: CM_BRIDGE_VERSION,
    getSnapshot,
    previewAction: typeof previewAction === 'function' ? previewAction : action => action,
    applyAction,
    undoAction: typeof undoAction === 'function' ? undoAction : null
  });
}

/**
 * Proposed /script adapter (pseudocode-level reference):
 *
 * defineCmPageBridge({
 *   getSnapshot() {
 *     return {
 *       version: 1,
 *       project: { kind: 'script-draft' },
 *       page: { id: 'script', name: '剧本生成', path: '/script' },
 *       selection: activeEntity && {
 *         type: activeEntity.type === 'characters' ? 'character' : 'scene',
 *         id: activeEntity.id,
 *         label: entityName(activeItem),
 *         data: entityData(activeItem)
 *       },
 *       context: { novelText, extractInfo, output, constraints },
 *       capabilities: [
 *         'character.update', 'character.create', 'character.setProtagonist',
 *         'scene.update', 'script.replace', 'constraint.bind', 'constraint.update'
 *       ]
 *     };
 *   },
 *   applyAction(action) {
 *     // Route by exact capability; reuse ScriptPage state/API mutations.
 *     // Never query DOM and never edit inputs by selector.
 *   }
 * });
 */
