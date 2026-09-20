export function h3PromptEditRequest(trace, index, text) {
  const revision = trace?.compilation;
  const compilation = revision?.compilation;
  const segments = compilation?.segments || [];
  const target = segments[index];
  const audio = trace?.timeline?.timeline?.audio_asset_id;
  if (!target || !revision.id || !audio || !String(text).trim()) throw new Error('完整分镜编译记录缺失或提示词为空，请刷新后重试');
  const overrides = {};
  for (const segment of segments) {
    if (segment.compile_trace?.editable_copy_source === 'user_final_prompt') {
      overrides[segment.segment_key] = { text: segment.compiled_prompt, revision: segment.editable_copy_revision };
    }
  }
  overrides[target.segment_key] = { text, revision: Number(target.editable_copy_revision || 1) + 1 };
  return {
    director_revision_id: trace.director_revision_id,
    audio_asset_id: audio,
    expected_compilation_id: revision.id,
    preset: compilation.video_preset,
    switches: segments[0]?.compile_trace?.switches || {},
    final_prompt_overrides: overrides
  };
}
