const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(path, from, to, label) {
  const source = read(path);
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: source not found in ${path}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: source occurs more than once in ${path}`);
  write(path, source.slice(0, first) + to + source.slice(first + from.length));
}
function replaceRegex(path, regex, to, label) {
  const source = read(path);
  const matches = source.match(regex);
  if (!matches) throw new Error(`${label}: regex not found in ${path}`);
  write(path, source.replace(regex, to));
}

// 1) Backend editable system-preset catalog.
{
  const path = 'lib/system-preset-catalog.js';
  replaceOnce(path,
    "  ['script-general', '通用规则', '剧本生成通用约束', '通用规则.md'],\n",
    "  ['script-general', '通用规则', '剧本生成通用约束', '通用规则.md'],\n" +
    "  ['script-character-focus', '星标人物聚焦规则', '星标人物作为剧情与镜头聚焦变量的生成规则', '星标人物聚焦规则.md'],\n" +
    "  ['script-audio-match', '匹配音频规则', '普通剧本生成按当前配音实际总时长约束最终分镜', '匹配音频规则.md'],\n",
    'register script focus/audio presets');

  replaceOnce(path,
    "  ['script.general', 'script', '通用规则', 'primary'],\n",
    "  ['script.general', 'script', '通用规则', 'primary'],\n" +
    "  ['script.character-focus', 'script', '星标人物聚焦规则', 'primary'],\n" +
    "  ['script.audio-match', 'script', '匹配音频规则', 'primary'],\n",
    'register script focus/audio slots');

  replaceOnce(path,
    "  'script-general': 'script.general',\n",
    "  'script-general': 'script.general',\n" +
    "  'script-character-focus': 'script.character-focus',\n" +
    "  'script-audio-match': 'script.audio-match',\n",
    'map script focus/audio slots');
}

// 2) Active script backend: stars are a focus variable; audio matching is a normal script prompt add-on.
{
  const path = 'routes/chat.js';
  replaceRegex(path,
    /function sanitizeProtagonists\(characters, protagonists\) \{[\s\S]*?\n\}\n\nfunction buildScriptMessages\(body, presetStore, personalPromptStore, username\) \{/,
`function sanitizeFocusCharacters(characters, selectedCharacters) {
  const known = new Set((Array.isArray(characters) ? characters : []).map(item => JSON.stringify(item)));
  return (Array.isArray(selectedCharacters) ? selectedCharacters : []).filter(item => known.has(JSON.stringify(item)));
}

function focusCharacterName(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return String(value['角色名称'] || value['姓名'] || value['名称'] || value.name || '').trim();
}

function buildCharacterFocusPrompt(presetStore, characters, selectedCharacters) {
  const names = sanitizeFocusCharacters(characters, selectedCharacters)
    .map(focusCharacterName)
    .filter(Boolean);
  if (!names.length) return '';
  const focusCharacters = names.join('、');
  return resolveSystemPresetBody(presetStore, 'script-character-focus')
    .replace(/\\{focusCharacters\\}/g, focusCharacters)
    .replace(/\\{focusCount\\}/g, String(names.length));
}

function normalizeScriptAudioSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 600) return null;
  return Math.round(parsed * 100) / 100;
}

function buildScriptAudioMatchPrompt(presetStore, body, duration) {
  if (body?.matchAudio !== true) return '';
  const audioDurationSec = normalizeScriptAudioSeconds(body?.audioTotalSeconds);
  if (audioDurationSec === null) throw new Error('匹配音频已开启，但没有有效的当前配音时长');
  const unitMaxSec = normalizeDuration(duration) === '15s' ? '15' : '10';
  return resolveSystemPresetBody(presetStore, 'script-audio-match')
    .replace(/\\{audioDurationSec\\}/g, String(audioDurationSec))
    .replace(/\\{unitMaxSec\\}/g, unitMaxSec)
    .replace(/\\{duration\\}/g, normalizeDuration(duration));
}

function buildScriptMessages(body, presetStore, personalPromptStore, username) {`,
    'replace protagonist whitelist with focus/audio helpers');

  replaceOnce(path,
    "  const durationGuard = `## 当前单条视频最大时长（最高优先级）\\n${buildStoryboardUnitDurationRules(duration)} 每个最终外层分镜的结束时间不得超过 ${endTime}。10s/15s 是上限，不是固定目标时长；禁止先输出超时分镜再按固定秒数硬切。`;\n  const protagonistPrompt = buildProtagonistPrompt(body.characters, body.protagonists);\n  const cardProtocol = buildScriptCardProtocol(presetStore, duration);\n",
    "  const durationGuard = `## 当前单条视频最大时长（最高优先级）\\n${buildStoryboardUnitDurationRules(duration)} 每个最终外层分镜的结束时间不得超过 ${endTime}。10s/15s 是上限，不是固定目标时长；禁止先输出超时分镜再按固定秒数硬切。`;\n  const characterFocusPrompt = buildCharacterFocusPrompt(presetStore, body.characters, body.protagonists);\n  const audioMatchPrompt = buildScriptAudioMatchPrompt(presetStore, body, duration);\n  const cardProtocol = buildScriptCardProtocol(presetStore, duration);\n",
    'wire focus/audio prompts into script generation');

  replaceOnce(path,
    "    durationGuard,\n    constraintWrapper,\n",
    "    durationGuard,\n    audioMatchPrompt,\n    characterFocusPrompt,\n    constraintWrapper,\n",
    'include focus/audio prompts in system prompt');

  replaceOnce(path,
    "        '\\n\\n## 场景信息\\n' + serializePromptSection(body.scenes) +\n        (protagonistPrompt ? '\\n\\n' + protagonistPrompt : '') +\n        '\\n\\n请在同一次推理中，先执行当前选中的开头提示词，再继续执行当前选中的' + formatName + '提示词，并直接输出最终成品。'\n",
    "        '\\n\\n## 场景信息\\n' + serializePromptSection(body.scenes) +\n        '\\n\\n请在同一次推理中，先执行当前选中的开头提示词，再继续执行当前选中的' + formatName + '提示词，并直接输出最终成品。'\n",
    'remove old protagonist user-message block');
}

// 3) Normal script API carries audio-match variables in the same AI request.
{
  const path = 'frontend/src/shared/api/generation.js';
  replaceOnce(path,
    "export async function generateScript({ mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints }) {\n  const resolved = await resolveSmartUnifiedGenerationInput({\n    mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints\n  });\n",
    "export async function generateScript({ mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints, matchAudio, audioTotalSeconds }) {\n  const resolved = await resolveSmartUnifiedGenerationInput({\n    mode, format, duration, novelText, characters, scenes, visualStyle, protagonists, constraints, matchAudio, audioTotalSeconds\n  });\n",
    'extend normal script API input');

  replaceOnce(path,
    "      protagonists: resolved.protagonists,\n      constraints: resolved.constraints,\n",
    "      protagonists: resolved.protagonists,\n      constraints: resolved.constraints,\n      matchAudio: resolved.matchAudio === true,\n      audioTotalSeconds: resolved.matchAudio === true ? resolved.audioTotalSeconds : null,\n",
    'send normal script audio variables');

  replaceOnce(path,
    "  // 普通“生成剧本/分镜”始终只发起一次 script AI 请求：\n  // 当前开头预设 + 当前输出模式预设 + 10s/15s 运行规则 + 人物场景/主角资料\n  // 在服务端同一次 messages 组合后直接生成最终结果。\n",
    "  // 普通“生成剧本/分镜”始终只发起一次 script AI 请求：\n  // 开头 + 通用规则 + 输出模式 + 人物场景 + 星标聚焦变量 + 10s/15s 上限 + 可选匹配音频规则\n  // 都由服务端后台预设在同一次 messages 中组合后直接生成最终结果。\n",
    'update normal generation contract comment');
}

// 4) Script UI: match audio becomes a setting for normal Generate Script, not a separate quick-director action.
{
  const path = 'frontend/src/user/pages/ScriptPage.jsx';
  replaceOnce(path,
    "import { deleteScriptConstraintPrompt, extractCharactersAndScenes, generateQuickDirectorStoryboard, generateScript, getConstraintPresetTexts, listScriptConstraintPrompts, listScriptPresetCatalog, saveScriptConstraintPrompt, updateScriptConstraintPrompt } from '../../shared/api/generation';\n",
    "import { deleteScriptConstraintPrompt, extractCharactersAndScenes, generateScript, getConstraintPresetTexts, listScriptConstraintPrompts, listScriptPresetCatalog, saveScriptConstraintPrompt, updateScriptConstraintPrompt } from '../../shared/api/generation';\n",
    'remove quick-director API import');
  replaceOnce(path,
    "import { createEntity, entityData, normalizeExtractInfo, selectDefaultProtagonistIds, toGenerationEntities } from './scriptEntities';\n",
    "import { createEntity, entityData, normalizeExtractInfo, toGenerationEntities } from './scriptEntities';\n",
    'remove automatic protagonist selection import');
  replaceOnce(path,
    "  const [narrating, setNarrating] = useState(false);\n  const [quickDirecting, setQuickDirecting] = useState(false);\n  const [quickDirectorOpen, setQuickDirectorOpen] = useState(false);\n  const [quickDirectorOptions, setQuickDirectorOptions] = useState({ descriptionMode: 'strict', mustCoverDetails: '', shotRhythmRequirements: '', matchAudio: false });\n",
    "  const [narrating, setNarrating] = useState(false);\n  const [quickDirectorOpen, setQuickDirectorOpen] = useState(false);\n  const [quickDirectorOptions, setQuickDirectorOptions] = useState({ matchAudio: false });\n",
    'simplify audio-match UI state');

  replaceOnce(path,
`  function openQuickDirectorStoryboard() {
    const source = String(form.getFieldValue('novelText') || '').trim();
    if (!source) return message.warning('请先粘贴小说原文');
    setQuickDirectorOpen(true);
  }
`,
`  function openAudioMatchSettings() {
    const source = String(form.getFieldValue('novelText') || '').trim();
    if (!source) return message.warning('请先粘贴小说原文');
    setQuickDirectorOpen(true);
  }
`,
    'rename audio settings opener');

  replaceRegex(path,
    /\n  async function quickDirectorStoryboard\(\) \{[\s\S]*?\n  \}\n\n  function replaceSourceAudio/,
    '\n  function replaceSourceAudio',
    'remove separate quick-director generation transaction');

  replaceOnce(path,
    "    return { ...extraction, protagonistIds: selectDefaultProtagonistIds(extraction, novelText) };\n",
    "    return extraction;\n",
    'stop automatically starring a default protagonist');

  replaceOnce(path,
    "  async function generateOutput() {\n    const values = form.getFieldsValue();\n    if (!extractInfo.characters.length && !extractInfo.scenes.length) return message.warning('请先提取人物与场景');\n    const requestId = beginRequest('workflow');\n",
    "  async function generateOutput() {\n    const values = form.getFieldsValue();\n    if (!extractInfo.characters.length && !extractInfo.scenes.length) return message.warning('请先提取人物与场景');\n    if (quickDirectorOptions.matchAudio && !sourceAudioDurationSeconds) {\n      return message.warning('请先生成当前原文配音；匹配音频需要读取实际音频时长');\n    }\n    const requestId = beginRequest('workflow');\n",
    'guard normal generation when audio matching is enabled');

  replaceOnce(path,
    "        ...entities,\n        constraints: requestConstraints\n      });\n",
    "        ...entities,\n        constraints: requestConstraints,\n        matchAudio: quickDirectorOptions.matchAudio,\n        audioTotalSeconds: quickDirectorOptions.matchAudio ? sourceAudioDurationSeconds : null\n      });\n",
    'send audio match with normal generateScript');

  replaceOnce(path,
    "                <button type=\"button\" aria-label=\"匹配音频\" title=\"按当前配音时长生成完整视频分镜\" onClick={openQuickDirectorStoryboard} disabled={quickDirecting}><Clapperboard size={17} strokeWidth={1.8} aria-hidden=\"true\" /></button>\n",
    "                <button type=\"button\" aria-label=\"匹配音频\" title=\"设置生成剧本时是否匹配当前配音时长\" onClick={openAudioMatchSettings}><Clapperboard size={17} strokeWidth={1.8} aria-hidden=\"true\" /></button>\n",
    'make match audio button settings-only');

  replaceRegex(path,
    /      <Modal\n        title=\"匹配音频\"[\s\S]*?      <\/Modal>\n      <Modal title=\"剧本生成历史\"/,
`      <Modal
        title="匹配音频设置"
        open={quickDirectorOpen}
        okText="保存设置"
        cancelText="取消"
        onCancel={() => setQuickDirectorOpen(false)}
        onOk={() => {
          if (quickDirectorOptions.matchAudio && !sourceAudioDurationSeconds) {
            message.warning('请先生成当前原文配音；匹配音频需要读取实际音频时长');
            return;
          }
          setQuickDirectorOpen(false);
        }}
      >
        <Typography.Paragraph type="secondary">
          这里只控制下一次“生成剧本”是否加入匹配音频规则，不会单独调用 AI。开启后，后台会把实际配音秒数与当前 10s / 15s 单分镜上限一起加入本次生成提示词。
        </Typography.Paragraph>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Text strong>匹配当前配音时长</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0' }}>
              {sourceAudioDurationSeconds ? `当前配音：${sourceAudioDurationSeconds} 秒；生成剧本时总分镜时长将严格匹配。` : '请先点击配音按钮生成当前原文配音。'}
            </Typography.Paragraph>
          </div>
          <Switch
            checked={quickDirectorOptions.matchAudio}
            onChange={matchAudio => setQuickDirectorOptions(current => ({ ...current, matchAudio }))}
          />
        </Space>
      </Modal>
      <Modal title="剧本生成历史"`,
    'replace quick-director modal with audio settings modal');
}

// 5) Preserve actual audio metadata to hundredths.
{
  const path = 'frontend/src/user/pages/scriptGenerationRules.js';
  replaceOnce(path,
    '  return Math.ceil(parsed);\n',
    '  return Math.round(parsed * 100) / 100;\n',
    'preserve audio duration to hundredths');
}

// 6) Update existing tests to the new normal-generation contract.
{
  const path = 'tests/script-generation-rules-frontend.test.mjs';
  let source = read(path);
  source = source.replace(
`test('frontend audio duration is represented as an integer ceiling', () => {
  assert.equal(normalizeAudioDurationSeconds(28.01), 29);
  assert.equal(normalizeAudioDurationSeconds('28'), 28);
  assert.equal(normalizeAudioDurationSeconds(-1), null);
});`,
`test('frontend audio duration preserves actual hundredths', () => {
  assert.equal(normalizeAudioDurationSeconds(28.369), 28.37);
  assert.equal(normalizeAudioDurationSeconds('28'), 28);
  assert.equal(normalizeAudioDurationSeconds(-1), null);
});`);
  source = source.replace("  assert.equal(await readAudioDurationFromUrl('blob:audio', { AudioCtor: FakeAudio }), 29);", "  assert.equal(await readAudioDurationFromUrl('blob:audio', { AudioCtor: FakeAudio }), 28.01);");
  if (!source.includes("frontend audio duration preserves actual hundredths") || source.includes("integer ceiling")) throw new Error('frontend duration test update failed');
  write(path, source);
}

{
  const path = 'tests/script-match-audio-ui-contract.test.js';
  write(path, `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('frontend/src/user/pages/ScriptPage.jsx', 'utf8');
const api = fs.readFileSync('frontend/src/shared/api/generation.js', 'utf8');

test('script page exposes match audio as a normal generation setting', () => {
  assert.match(page, /aria-label="匹配音频"/);
  assert.match(page, /title="匹配音频设置"/);
  assert.match(page, /matchAudio: false/);
  assert.match(page, /sourceAudioDurationSeconds/);
  assert.doesNotMatch(page, /画面描述模式/);
  assert.doesNotMatch(page, /分析并生成/);
  assert.doesNotMatch(page, /generateQuickDirectorStoryboard/);
});

test('normal generateScript API carries audio matching in the same script request', () => {
  assert.match(api, /export async function generateScript\\(\\{[\\s\\S]*?matchAudio[\\s\\S]*?audioTotalSeconds/);
  assert.match(api, /promptType: 'script'/);
  assert.match(api, /matchAudio: resolved\\.matchAudio === true/);
  assert.match(api, /audioTotalSeconds:/);
});
`);
}

// The V78-named contract is the CI-gated source of truth; remove the duplicate RED-only file.
if (fs.existsSync('tests/script-focus-audio-generation-contract.test.js')) fs.unlinkSync('tests/script-focus-audio-generation-contract.test.js');

console.log('Applied star-focus + normal audio-match integration.');
