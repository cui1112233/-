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
  const quality = cleanText(settings.quality);
  const restriction = cleanText(settings.restriction);
  const negative = cleanText(settings.negative);
  const videoDesc = cleanText(video.visualPrompt || video.visual_prompt || video.video_desc || video.videoDesc);
  if (!videoDesc) throw new Error('video_desc 不能为空');

  const parts = [
    `【视频时长：${durationSec}秒】`,
    `【画幅：${aspectRatio}】`,
    section('画面前缀', prefix),
    settings.characterPromptEnabled === false ? '' : section('人物设定', characters),
    settings.scenePromptEnabled === false ? '' : section('场景设定', scenePrompt),
    settings.propPromptEnabled === false ? '' : section('道具设定', props),
    section('视频分镜', videoDesc),
    settings.qualityEnabled === false ? '' : section('画质约束', quality),
    settings.restrictionEnabled === false ? '' : section('画面限制', restriction),
    settings.subtitlePolicy ? section('文字与字幕限制', settings.subtitlePolicy) : '',
    settings.negativeEnabled === false ? '' : (negative ? `负面提示词：\n${negative}` : '')
  ].filter(Boolean);

  const prompt = parts.join('\n\n');
  return {
    duration: durationSec,
    aspect_ratio: aspectRatio,
    // Keep the editable narrative separate from the generated submission.
    visualPrompt: videoDesc,
    compiledPrompt: prompt,
    prompt,
    compiledSections: parts.map(part => part.match(/^【([^】]+)】/)?.[1] || '负面提示词')
  };
}

module.exports = { compileVideoPrompt };
