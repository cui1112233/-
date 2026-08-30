const ALLOWED_ASPECT_RATIOS = new Set(['9:16', '16:9']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${field} 必须是整数`);
  return number;
}

function parseDirectorJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = cleanText(value);
  if (!text) throw new Error('导演模型返回为空');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('导演模型没有返回合法 JSON');
  }
}

function normalizeNamedPrompts(value, label) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label}[${index}] 格式无效`);
    const name = cleanText(item.name || item.名称 || item.角色名称 || item.场景名称);
    const prompt = cleanText(item.prompt || item.提示词 || item.description || item.描述);
    if (!name) throw new Error(`${label}[${index}] 缺少名称`);
    if (!prompt) throw new Error(`${label}[${index}] 缺少提示词`);
    if (seen.has(name)) throw new Error(`${label}存在重复名称：${name}`);
    seen.add(name);
    return { name, prompt };
  });
}

function normalizeShots(value, durationSec, videoIndex) {
  const shots = Array.isArray(value) ? value : [];
  if (!shots.length) throw new Error(`storyboard[${videoIndex}] 至少需要一个镜头`);
  let cursor = 0;
  return shots.map((shot, shotIndex) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new Error(`storyboard[${videoIndex}].shots[${shotIndex}] 格式无效`);
    const startSec = toInteger(shot.start_sec ?? shot.startSec, `storyboard[${videoIndex}].shots[${shotIndex}].start_sec`);
    const endSec = toInteger(shot.end_sec ?? shot.endSec, `storyboard[${videoIndex}].shots[${shotIndex}].end_sec`);
    if (startSec !== cursor) throw new Error(`storyboard[${videoIndex}] 镜头时间轴必须连续，期望从 ${cursor} 秒开始`);
    if (endSec <= startSec) throw new Error(`storyboard[${videoIndex}].shots[${shotIndex}] 结束时间必须大于开始时间`);
    const description = cleanText(shot.description || shot.desc || shot.画面 || shot.prompt);
    if (!description) throw new Error(`storyboard[${videoIndex}].shots[${shotIndex}] 缺少画面描述`);
    cursor = endSec;
    return {
      start_sec: startSec,
      end_sec: endSec,
      shot_type: cleanText(shot.shot_type || shot.shotType || shot.景别),
      camera: cleanText(shot.camera || shot.运镜),
      description
    };
  }).map((shot, index, normalized) => {
    if (index === normalized.length - 1 && shot.end_sec !== durationSec) {
      throw new Error(`storyboard[${videoIndex}] 最后一个镜头必须结束在 ${durationSec} 秒`);
    }
    return shot;
  });
}

function normalizeNameRefs(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,，]/))
    .map(item => typeof item === 'string' ? item.trim() : cleanText(item?.name))
    .filter(Boolean))];
}

function normalizeDirectorOutput(rawValue, settings = {}) {
  const raw = parseDirectorJson(rawValue);
  const maxVideoDuration = toInteger(settings.maxVideoDuration, 'maxVideoDuration');
  if (maxVideoDuration < 1 || maxVideoDuration > 60) throw new Error('maxVideoDuration 超出允许范围');
  const fixedSingleVideo = settings.fixedSingleVideo === true;
  const exactDuration = fixedSingleVideo ? toInteger(settings.exactDuration, 'exactDuration') : null;
  if (fixedSingleVideo && (exactDuration < 1 || exactDuration > maxVideoDuration)) throw new Error('exactDuration 必须位于模型最大时长范围内');
  const aspectRatio = cleanText(settings.aspectRatio || '9:16');
  if (!ALLOWED_ASPECT_RATIOS.has(aspectRatio)) throw new Error('aspectRatio 仅支持 9:16 或 16:9');

  const characters = normalizeNamedPrompts(raw.characters, 'characters');
  const scenes = normalizeNamedPrompts(raw.scenes, 'scenes');
  const props = normalizeNamedPrompts(raw.props, 'props');
  const characterNames = new Set(characters.map(item => item.name));
  const sceneNames = new Set(scenes.map(item => item.name));
  const propNames = new Set(props.map(item => item.name));
  const allowedPrefixKeys = new Set(Array.isArray(settings.allowedPrefixKeys) ? settings.allowedPrefixKeys : []);
  const sourceVideos = Array.isArray(raw.storyboard) ? raw.storyboard : [];
  if (!sourceVideos.length) throw new Error('storyboard 不能为空');
  if (fixedSingleVideo && sourceVideos.length !== 1) throw new Error('固定单镜头模式只能输出一个视频单元');

  const storyboard = sourceVideos.map((video, videoIndex) => {
    if (!video || typeof video !== 'object' || Array.isArray(video)) throw new Error(`storyboard[${videoIndex}] 格式无效`);
    const durationSec = toInteger(video.duration_sec ?? video.durationSec, `storyboard[${videoIndex}].duration_sec`);
    if (durationSec < 1 || durationSec > maxVideoDuration) throw new Error(`storyboard[${videoIndex}] 时长必须在 1-${maxVideoDuration} 秒之间`);
    if (fixedSingleVideo && durationSec !== exactDuration) throw new Error(`固定单镜头模式必须严格输出 ${exactDuration} 秒`);

    const characterRefs = normalizeNameRefs(video.characters);
    const propRefs = normalizeNameRefs(video.props);
    const scene = cleanText(typeof video.scene === 'string' ? video.scene : video.scene?.name);
    for (const name of characterRefs) if (!characterNames.has(name)) throw new Error(`storyboard[${videoIndex}] 引用了未知人物：${name}`);
    for (const name of propRefs) if (!propNames.has(name)) throw new Error(`storyboard[${videoIndex}] 引用了未知道具：${name}`);
    if (scene && !sceneNames.has(scene)) throw new Error(`storyboard[${videoIndex}] 引用了未知场景：${scene}`);

    const prefixKey = cleanText(video.prefix_key || video.prefixKey);
    if (allowedPrefixKeys.size && prefixKey && !allowedPrefixKeys.has(prefixKey)) throw new Error(`storyboard[${videoIndex}] 使用了未知前缀类型：${prefixKey}`);
    const videoDesc = cleanText(video.video_desc || video.videoDesc);
    const visualPrompt = cleanText(video.visualPrompt || video.visual_prompt || videoDesc);
    if (!videoDesc) throw new Error(`storyboard[${videoIndex}] 缺少 video_desc`);

    return {
      id: video.id ?? videoIndex + 1,
      scene_id: video.scene_id ?? video.sceneId ?? videoIndex + 1,
      duration_sec: durationSec,
      characters: characterRefs,
      props: propRefs,
      scene,
      prefix_key: prefixKey,
      shots: normalizeShots(video.shots, durationSec, videoIndex),
      video_desc: videoDesc,
      visualPrompt
    };
  });

  return {
    characters,
    scenes,
    props,
    storyboard,
    source_coverage: raw.source_coverage && typeof raw.source_coverage === 'object'
      ? {
        source_complete: raw.source_coverage.source_complete === true,
        source_end_marker: cleanText(raw.source_coverage.source_end_marker),
        has_remaining_source: raw.source_coverage.has_remaining_source === true
      }
      : { source_complete: !fixedSingleVideo, source_end_marker: '', has_remaining_source: fixedSingleVideo }
  };
}

module.exports = {
  ALLOWED_ASPECT_RATIOS,
  parseDirectorJson,
  normalizeDirectorOutput
};
