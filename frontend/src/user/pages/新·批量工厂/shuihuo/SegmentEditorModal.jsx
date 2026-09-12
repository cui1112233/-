import { Checkbox, Input, Modal } from 'antd';

export function SegmentEditorModal({ open, segment, saving, onCancel, onSave, onChange }) {
  const editing = Boolean(segment?.id);
  return <Modal title={editing ? `编辑分段 #${segment.orderIndex}` : '新增人工分段'} open={open} onCancel={onCancel} onOk={onSave} okText="保存人工修改" confirmLoading={saving} width={760}>
    <label className="shuihuo-form-label">原文</label>
    <Input.TextArea value={segment?.sourceText || ''} onChange={event => onChange({ ...segment, sourceText: event.target.value })} rows={5} placeholder="填写当前分段原文" />
    <label className="shuihuo-form-label">字幕</label>
    <Input.TextArea value={segment?.subtitleText || ''} onChange={event => onChange({ ...segment, subtitleText: event.target.value })} rows={3} placeholder="可选：配音或字幕文本" />
    <label className="shuihuo-form-label">图片提示词</label>
    <Input.TextArea value={segment?.imagePrompt || ''} onChange={event => onChange({ ...segment, imagePrompt: event.target.value, imagePromptLocked: true })} rows={4} placeholder="人工保存后锁定，后续 AI 候选不会覆盖。" />
    <Checkbox checked={Boolean(segment?.imagePromptLocked)} onChange={event => onChange({ ...segment, imagePromptLocked: event.target.checked })}>锁定图片提示词</Checkbox>
    <label className="shuihuo-form-label">视频提示词</label>
    <Input.TextArea value={segment?.videoPrompt || ''} onChange={event => onChange({ ...segment, videoPrompt: event.target.value, videoPromptLocked: true })} rows={4} placeholder="人工保存后锁定，后续 AI 候选不会覆盖。" />
    <Checkbox checked={Boolean(segment?.videoPromptLocked)} onChange={event => onChange({ ...segment, videoPromptLocked: event.target.checked })}>锁定视频提示词</Checkbox>
  </Modal>;
}
