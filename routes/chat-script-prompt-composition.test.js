const test = require('node:test');
const assert = require('node:assert/strict');

const chatRouter = require('./chat');

function presetStore() {
  const bodies = {
    'script-segmented': 'SEGMENTED_OPENING_PROMPT',
    'script-format-shotlist': 'SHOTLIST_MODE_PROMPT',
    'script-general': 'GENERAL_PROMPT',
    'script-character-focus': 'STAR_FOCUS_RULE：剧情聚焦变量={focusCharacters}；数量={focusCount}；不得自动定义为主角。',
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

test('分段开头 + 分镜模式在一次 script 请求中组合，并始终带人物场景与星标聚焦变量', () => {
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
  assert.match(system, /STAR_FOCUS_RULE：剧情聚焦变量=陆沉、林晚；数量=2/);
  assert.doesNotMatch(system, /DIRECTOR_MASTER_SHOULD_NOT_BE_IN_NORMAL_SCRIPT_CALL/);
  assert.doesNotMatch(system, /陆沉为男主角|林晚为女主角/);

  assert.match(user, /## 人物信息/);
  assert.match(user, /陆沉/);
  assert.match(user, /林晚/);
  assert.match(user, /## 场景信息/);
  assert.match(user, /办公室/);
  assert.doesNotMatch(user, /男主角|女主角|为主角展开剧情/);
});

test('单星标人物只生成聚焦规则，不生成主角身份指令', () => {
  const starred = character('林晚', '女', '设计师');
  const body = {
    promptType: 'script',
    mode: 'segmented',
    format: 'shotlist',
    duration: '15s',
    novelText: '林晚独自站在雨中。',
    characters: [starred],
    scenes: [{ 场景名称: '街道', 场景描述: '雨夜街道' }],
    protagonists: [starred],
    constraints: { baseSetup: { enabled: false } }
  };

  const messages = chatRouter._private.buildScriptMessages(body, presetStore(), null, 'tester');
  assert.match(messages[0].content, /STAR_FOCUS_RULE：剧情聚焦变量=林晚；数量=1/);
  assert.doesNotMatch(messages[0].content, /林晚为主角/);
  assert.doesNotMatch(messages[1].content, /林晚为主角|为主角展开剧情/);
});
