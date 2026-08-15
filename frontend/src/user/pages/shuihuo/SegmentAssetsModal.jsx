import { useEffect, useState } from 'react';
import { Button, Checkbox, Modal, Select, message } from 'antd';
import { createAsset, listAssetTemplates, listAssetTypes } from '../../../shared/api/shuihuoProduction';

export function SegmentAssetsModal({ open, segment, projectId, assets, selectedIds, saving, onCancel, onChange, onSave, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [types, setTypes] = useState([]);
  const [templateId, setTemplateId] = useState();

  useEffect(() => {
    if (!open) return;
    Promise.all([listAssetTemplates(), listAssetTypes()]).then(([templateResult, typeResult]) => {
      setTemplates(templateResult.assetTemplates || []);
      setTypes(typeResult.assetTypes || []);
    }).catch(() => { setTemplates([]); setTypes([]); });
  }, [open]);

  async function applyTemplate() {
    const template = templates.find(item => item.id === templateId);
    if (!template) return;
    const existing = assets.find(item => item.name === template.name && item.category === types.find(type => type.id === template.assetTypeId)?.category);
    try {
      const asset = existing || await createAsset(projectId, { name: template.name, prompt: template.prompt, category: types.find(type => type.id === template.assetTypeId)?.category || 'character', source: 'template', manuallyEdited: true });
      if (!selectedIds.includes(asset.id)) onChange([...selectedIds, asset.id]);
      setTemplateId(undefined);
      onCreated?.();
      message.success('角色模板已应用');
    } catch (error) { message.error(error.message || '应用角色模板失败'); }
  }

  return <Modal title={`绑定资产${segment ? ` #${segment.orderIndex}` : ''}`} open={open} onCancel={onCancel} onOk={onSave} okText="保存绑定" confirmLoading={saving}>
    <p className="shuihuo-modal-note">这里可手动调整本段人物、场景与道具。AI 分析只会给出候选，必须由你确认后才写入。</p>
    <div className="shuihuo-template-apply"><Select value={templateId} onChange={setTemplateId} placeholder="从角色模板添加" options={templates.map(item => ({ value: item.id, label: item.name }))} /><Button onClick={applyTemplate} disabled={!templateId}>应用模板</Button></div>
    <div className="shuihuo-binding-list">{assets.map(asset => <Checkbox key={asset.id} checked={selectedIds.includes(asset.id)} onChange={event => onChange(event.target.checked ? [...selectedIds, asset.id] : selectedIds.filter(id => id !== asset.id))}>{asset.name}<small>{asset.prompt || '未设提示词'}</small></Checkbox>)}{!assets.length ? <span className="shuihuo-muted">请先在“人物场景预设”中添加资产。</span> : null}</div>
  </Modal>;
}
