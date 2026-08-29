const { ALLOWED_ASPECT_RATIOS } = require('./director-output');

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function namedPromptMap(items) {
  return new Map((Array.isArray(items) ? items : []).map(item => [cleanText(item?.name), cleanText(item?.prompt)]).filter(([name, prompt]) => name && prompt));
}

function section(title, body) {
  const text = cleanText(body);
  return text ? `【${title}】\n${text}` : '';
}

function entityLines(names, map) {
  return (Array.isArray(names) ? names : []).map(name => {
    const prompt = map.get(name);
    return prompt ? `${name}：${prompt}` : '';
  }).filter(Boolean).join('\n\n');
}

function assetNames(video) {
  const characters = Array.isArray(video.characters) ? video.characters.filter(Boolean) : [];
  const props = Array.isArray(video.props) ? video.props.filter(Boolean) : [];
  const scene = cleanText(video.scene);
  return [
    characters.length ? `人物：${characters.join('、')}` : '',
    scene ? `场景：${scene}` : '',
    props.length ? `道具：${props.join('、')}` : ''
  ].filter(Boolean).join('\n');
}

function shotTimeline(video) {
  const shots = Array.isArray(video.shots) ? video.shots : [];
  return shots.map((shot, index) => {
    const start = Number(shot.start_sec);
    const end = Number(shot.end_sec);
    const time = Number.isFinite(start) && Number.isFinite(end) ? `${start}-${end}秒` : `镜头${index + 1}`;
    return [
      `${index + 1}. ${time}`,
      cleanText(shot.shot_type),
      cleanText(shot.camera),
      cleanText(shot.description)
    ].filter(Boolean).join('｜');
  }).join('\n');
}

const DEFAULT_SUBTITLE_RESTRICTION = [
  '禁止画面生成自动对白字幕、台词文字、自动转写字幕、水印、Logo、二维码或无关可读文字。',
  '角色允许按照剧本正常说出台词并进行嘴型同步，但对白只通过声音和人物口型表现，不得自动显示为字幕文字。'
].join('\n');

function compileVideoPrompt({ directorResult, video, settings = {}, autoPrefix = '' }) {
  if (!directorResult || typeof directorResult !== 'object') throw new Error('directorResult 不能为空');
  if (!video || typeof video !== 'object') throw new Error('video 不能为空');
  const durationSec = Number(video.duration_sec);
  if (!Number.isInteger(durationSec) || durationSec < 1) throw new Error('视频时长必须是正整数');
  const aspectRatio = cleanText(settings.aspectRatio || '9:16');
  if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) throw new Error('画幅仅支持 9:16 或 16:9');

  const characterMap = namedPromptMap(directorResult.characters);
  const sceneMap = namedPromptMap(directorResult.scenes);
  const propMap = namedPromptMap(directorResult.props);
  const characters = entityLines(video.characters, characterMap);
  const scenePrompt = video.scene && sceneMap.get(video.scene) ? `${video.scene}：${sceneMap.get(video.scene)}` : '';
  const props = entityLines(video.props, propMap);

  const prefixMode = settings.prefixMode === 'manual' ? 'manual' : 'auto';
  const customPrefix = cleanText(settings.customPrefix);
  const prefixParts = prefixMode === 'manual'
    ? [customPrefix]
    : [cleanText(autoPrefix), customPrefix];
  const prefix = settings.prefixEnabled === false ? '' : prefixParts.filter(Boolean).join('\n');
  const quality = settings.qualityEnabled === false ? '' : cleanText(settings.quality);
  const restriction = settings.restrictionEnabled === false ? '' : cleanText(settings.restriction);
  const negative = settings.negativeEnabled === false ? '' : cleanText(settings.negative);
  const videoDesc = cleanText(video.visualPrompt || video.visual_prompt || video.video_desc || video.videoDesc);
  if (!videoDesc) throw new Error('VIDEO 剧情/画面提示词不能为空');

  const injectCharacter = settings.injectCharacterPrompt !== false;
  const injectScene = settings.injectScenePrompt !== false;
  const injectProp = settings.injectPropPrompt !== false;
  const subtitleRestriction = settings.subtitlePolicy === 'allow' ? '' : DEFAULT_SUBTITLE_RESTRICTION;
  const timeline = shotTimeline(video);

  // The provider receives one complete prompt string. Sections stay explicit in
  // the UI/compiler so users can understand exactly what is being uploaded.
  const parts = [
    `【视频参数】\n【视频时长：${durationSec}秒】\n【画幅：${aspectRatio}】`,
    section('整体画面前缀', prefix),
    section('本段资产', assetNames(video)),
    injectCharacter ? section('人物一致性', characters) : '',
    injectScene ? section('场景一致性', scenePrompt) : '',
    injectProp ? section('道具一致性', props) : '',
    section('当前VIDEO剧情', videoDesc),
    section('镜头时间轴', timeline),
    section('对白与声音', cleanText(video.dialogue_sound || video.dialogueSound || video.sound)),
    section('画质要求', quality),
    section('画面限制', restriction),
    section('文字与字幕限制', subtitleRestriction),
    section('负面提示词', negative)
  ].filter(Boolean);

  return {
    duration: durationSec,
    aspect_ratio: aspectRatio,
    prompt: parts.join('\n\n')
  };
}

module.exports = { compileVideoPrompt, DEFAULT_SUBTITLE_RESTRICTION };
