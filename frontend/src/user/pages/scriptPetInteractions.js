export function applyCmDraft(event, { updateOutputDraft, setEditingOutput, success }) {
  const nextOutput = String(event.detail?.content || '').trim();
  if (!nextOutput) return;
  updateOutputDraft(nextOutput);
  setEditingOutput(true);
  success('CM 的修改稿已写入当前剧本，请继续检查后保存。');
}
