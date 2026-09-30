const sdSceneDurationPattern = /总时长\s*([0-9]+(?:\.[0-9]+)?)\s*秒/g;

// realVideoDurationSeconds 把当前 VIDEO 正文里各场景的“总时长 X.XXX 秒”
// 相加，得到按语速/画面规划的真实时长；它和卡片整数 API 时长的差就是
// 末镜需要稳定保持的时间。解析不到（非 SD 卡）时返回 null。
export function realVideoDurationSeconds(promptText) {
  sdSceneDurationPattern.lastIndex = 0;
  let sum = 0;
  let found = false;
  for (const match of String(promptText || '').matchAll(sdSceneDurationPattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}
