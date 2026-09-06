const test = require('node:test');
const assert = require('node:assert/strict');

const chatRouter = require('./chat');

function presetStore() {
  const bodies = {
    'script-segmented': 'SEGMENTED_OPENING_PROMPT',
    'script-format-shotlist': 'SHOTLIST_MODE_PROMPT',
    'script-general': 'GENERAL_PROMPT',
    'script-director-storyboard-master': 'DIRECTOR_MASTER_SHOULD_NOT_BE_IN_NORMAL_SCRIPT_CALL'
  };
  return {
    getPublished(id) {
      if (!bodies[id]) return null;
      return {
        id,
        module: 'script',
        kind: 'base',
        body: bodies[id],
        protocolLock: { format: 'script' }
      };
    },
    listAll() { return []; }
  };
}

function character(name, gender, role = '') {
  return { 角色名称: name, 性别: gender, 身份: role };
}

test('分段开头 + 分镜模式在一次 script 请求中组合，并始终带人物场景与主角白名单', () => {
  const body = {
    promptType: 'script',
    mode: 'segmented',
    format: 'shotlist',
    duration: '10s',
    novelText: '林晚走进办公室，陆沉抬头看向她。',
    characters: [
      character('陆沉', '男', '集团总裁'),
      character('林晚', '女', '设计师'),
      character('秘书', '女', '配角')
    ],
    scenes: [{ 场景名称: '办公室', 场景描述: '现代集团办公室' }],
    protagonists: [
      character('陆沉', '男', '集团总裁'),
      character('林晚', '女', '设计师')
    ],
    constraints: {
      baseSetup: { enabled: false },
      prefix: { enabled: false },
      quality: { enabled: false },
      restriction: { enabled: false },
      negative: { enabled: false }
    }
  };

  const messages = chatRouter._private.buildScriptMessages(body, presetStore(), null, 'tester');
  assert.equal(messages.length, 2);

  const system = messages[0].content;
  const user = messages[1].content;

  assert.match(system, /SEGMENTED_OPENING_PROMPT/);
  assert.match(system, /SHOTLIST_MODE_PROMPT/);
  assert.doesNotMatch(system, /DIRECTOR_MASTER_SHOULD_NOT_BE_IN_NORMAL_SCRIPT_CALL/);

  assert.match(user, /## 人物信息/);
  assert.match(user, /陆沉/);
  assert.match(user, /林晚/);
  assert.match(user, /## 场景信息/);
  assert.match(user, /办公室/);
  assert.match(user, /以陆沉为男主角、林晚为女主角展开剧情/);
});

test('单核心人物白名单生成明确主角运行指令', () => {
  const protagonist = character('林晚', '女', '设计师');
  const body = {
    promptType: 'script',
    mode: 'segmented',
    format: 'shotlist',
    duration: '15s',
    novelText: '林晚独自站在雨中。',
    characters: [protagonist],
    scenes: [{ 场景名称: '街道', 场景描述: '雨夜街道' }],
    protagonists: [protagonist],
    constraints: { baseSetup: { enabled: false } }
  };

  const messages = chatRouter._private.buildScriptMessages(body, presetStore(), null, 'tester');
  assert.match(messages[1].content, /以林晚为主角展开剧情/);
});
