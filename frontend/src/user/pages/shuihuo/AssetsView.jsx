import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Modal, Popconfirm, Select, Tag, message } from 'antd';
import { analyzeAssets, applyAssetCandidates, createAsset, deleteAsset, listModels, updateAsset } from '../../../shared/api/shuihuoProduction';
import { dispatchCmSelection, registerCmBridge } from '../../../shared/pet/cmBridge';

const categories = [{ value: 'all', label: '全部' }, { value: 'character', label: '人物' }, { value: 'scene', label: '场景' }, { value: 'prop', label: '道具' }];
const assetCategories = categories.filter(item => item.value !== 'all');
const blankAsset = { category: 'character', name: '', prompt: '', referenceObjectKey: '' };
const cmAssetPatchKeys = ['category', 'name', 'prompt', 'referenceObjectKey'];

function categoryLabel(category) { return assetCategories.find(item => item.value === category)?.label || '人物'; }

export function selectedAssetCandidates(candidates) {
  return candidates.filter(item => item.selected && item.name?.trim() && item.prompt?.trim()).map(({ category, name, prompt }) => ({ category, name: name.trim(), prompt: prompt.trim() }));
}

export function AssetsView({ data, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState();
  const [candidates, setCandidates] = useState([]);
  const assets = useMemo(() => (data.assets || []).filter(asset => filter === 'all' || asset.category === filter), [data.assets, filter]);

  useEffect(() => registerCmBridge({
    page: '水货生产 · 人物场景预设',
    pagePath: '/shuihuo-production',
    capabilities: ['asset.update', 'asset.create'],
    getContext: () => ({
      page: '水货生产 · 人物场景预设',
      pagePath: '/shuihuo-production',
      project: { id: data.project?.id || '', name: data.project?.name || '' },
      summary: `当前项目有 ${data.assets?.length || 0} 个资产，可修改人物、场景、道具的名称和视觉提示词。`
    }),
    apply: async action => {
      if (action.type === 'asset.update') {
        const asset = (data.assets || []).find(item => item.id === action.targetId);
        if (!asset) throw new Error('找不到要修改的人物/场景资产，请重新点选后再试。');
        const patch = Object.fromEntries(cmAssetPatchKeys
          .filter(key => Object.prototype.hasOwnProperty.call(action.patch || {}, key))
          .map(key => [key, action.patch[key]]));
        const next = { ...asset, ...patch, source: 'manual', manuallyEdited: true };
        if (!String(next.name || '').trim()) throw new Error('资产名称不能为空。');
        await updateAsset(asset.id, next);
        await onRefresh();
        return { ok: true, message: `已更新「${next.name}」的人物/场景预设。` };
      }

      if (action.type === 'asset.create') {
        const source = { ...(action.payload || {}), ...(action.patch || {}) };
        const next = {
          ...blankAsset,
          ...Object.fromEntries(cmAssetPatchKeys.filter(key => Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]])),
          source: 'manual',
          manuallyEdited: true
        };
        if (!String(next.name || '').trim()) throw new Error('新资产需要名称。');
        await createAsset(data.project.id, next);
        await onRefresh();
        return { ok: true, message: `已创建「${next.name}」资产。` };
      }

      throw new Error('人物场景预设暂不支持这个 CM 操作。');
    }
  }), [data.project?.id, data.project?.name, data.assets, onRefresh]);

  function focusAsset(asset) {
    dispatchCmSelection({
      type: `asset.${asset.category || 'character'}`,
      id: asset.id,
      label: asset.name || '未命名资产',
      meta: {
        category: asset.category,
        prompt: asset.prompt || '',
        referenceObjectKey: asset.referenceObjectKey || ''
      }
    });
  }

  async function save() {
    if (!editing?.name?.trim()) { message.warning('请填写资产名称'); return; }
    setSaving(true);
    try {
      const payload = { ...editing, name: editing.name.trim(), source: 'manual', manuallyEdited: true };
      if (editing.id) await updateAsset(editing.id, payload); else await createAsset(data.project.id, payload);
      setOpen(false); setEditing(null); await onRefresh(); message.success('人工资产已保存');
    } catch (error) { message.error(error.message || '保存资产失败'); } finally { setSaving(false); }
  }

  async function remove(asset) { try { await deleteAsset(asset.id); await onRefresh(); message.success('资产已删除'); } catch (error) { message.error(error.message || '删除资产失败'); } }

  async function openAnalysis() {
    try {
      const result = await listModels();
      setModels((result.models || []).filter(model => model.kind === 'text'));
      setCandidates([]);
      setModelId();
      setOpen('analysis');
    } catch (error) { message.error(error.message || '读取文本模型失败'); }
  }

  async function analyze() {
    if (!modelId) { message.warning('请选择文本模型'); return; }
    setSaving(true);
    try {
      const result = await analyzeAssets(data.project.id, { modelId });
      setCandidates((result.candidates || []).map((item, index) => ({ ...item, key: `${item.category}-${item.name}-${index}`, selected: true })));
    } catch (error) { message.error(error.message || '资产分析失败'); } finally { setSaving(false); }
  }

  function updateCandidate(key, patch) { setCandidates(items => items.map(item => item.key === key ? { ...item, ...patch } : item)); }

  async function applyCandidates() {
    const selected = selectedAssetCandidates(candidates);
    if (!selected.length) { message.warning('请至少选择一项并填写名称、视觉提示词'); return; }
    setSaving(true);
    try {
      await applyAssetCandidates(data.project.id, selected);
      setCandidates(items => items.filter(item => !item.selected));
      await onRefresh();
      message.success(`已采纳 ${selected.length} 项资产，可回到分镜绑定使用`);
    } catch (error) { message.error(error.message || '采纳资产候选失败'); } finally { setSaving(false); }
  }

  return <section className="shuihuo-view">
    <div className="shuihuo-page-heading"><div><h2>人物场景预设</h2><p>先点击“分析候选”，审阅后采纳人物、场景和道具；再回到分镜为每段绑定资产。</p></div><div className="shuihuo-actions"><Button onClick={openAnalysis}>分析候选</Button><Button type="primary" onClick={() => { setEditing({ ...blankAsset }); setOpen(true); }}>添加资产</Button></div></div>
    <div className="shuihuo-asset-tabs">{categories.map(item => <button type="button" className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)} key={item.value}>{item.label}</button>)}</div>
    <div className="shuihuo-asset-grid">{assets.map(asset => <article className="shuihuo-asset-card" key={asset.id} tabIndex={0} onClick={() => focusAsset(asset)} onFocus={() => focusAsset(asset)}><div className={`shuihuo-asset-visual is-${asset.category || 'character'}`}><span>{asset.name}</span><b>{asset.manuallyEdited ? '人工' : 'AI 候选'}</b></div><div className="shuihuo-asset-card-title"><strong>{asset.name}</strong><Tag>{categoryLabel(asset.category)}</Tag></div><p>{asset.prompt || '尚未填写视觉提示词'}</p><div className="shuihuo-asset-card-actions"><Button type="text" size="small" onClick={() => { setEditing({ ...asset }); setOpen(true); }}>编辑</Button><Popconfirm title="删除资产后会同时解除其分段绑定。" onConfirm={() => remove(asset)}><Button type="text" danger size="small">删除</Button></Popconfirm></div></article>)}{!assets.length ? <div className="shuihuo-empty"><b>+</b><p>{filter === 'all' ? '尚未添加人物、场景或道具' : `尚未添加${categoryLabel(filter)}`}</p><Button onClick={() => { setEditing({ ...blankAsset, category: filter === 'all' ? 'character' : filter }); setOpen(true); }}>添加资产</Button></div> : null}</div>
    <Modal title={editing?.id ? '编辑人工资产' : '添加人工资产'} open={open === true} onCancel={() => { setOpen(false); setEditing(null); }} onOk={save} okText="保存人工资产" confirmLoading={saving}><label className="shuihuo-form-label">类型</label><Select value={editing?.category} onChange={category => setEditing(item => ({ ...item, category }))} options={assetCategories} /><label className="shuihuo-form-label">名称</label><Input value={editing?.name} onChange={event => setEditing(item => ({ ...item, name: event.target.value }))} /><label className="shuihuo-form-label">视觉提示词</label><Input.TextArea rows={5} value={editing?.prompt} onChange={event => setEditing(item => ({ ...item, prompt: event.target.value }))} /></Modal>
    <Modal title="AI 资产分析候选" open={open === 'analysis'} onCancel={() => setOpen(false)} width={820} footer={candidates.length ? <><Button onClick={() => setCandidates(items => items.map(item => ({ ...item, selected: true })))}>全选</Button><Button onClick={() => setCandidates(items => items.map(item => ({ ...item, selected: false })))}>取消全选</Button><Button type="primary" loading={saving} onClick={applyCandidates}>采纳已选</Button></> : <Button onClick={() => setOpen(false)}>关闭</Button>}>
      <p className="shuihuo-modal-note">第 3 步：选择文本模型生成候选。AI 不会自动写入项目；请检查并采纳需要的人物、场景或道具。</p>
      <div className="shuihuo-analysis-controls"><Select value={modelId} onChange={setModelId} placeholder="选择文本模型" options={models.map(model => ({ value: model.id, label: model.name }))} /><Button type="primary" loading={saving} onClick={analyze}>生成候选</Button></div>
      {candidates.length ? <div className="shuihuo-candidate-list">{candidates.map(item => <article className="shuihuo-candidate-card" key={item.key}><Checkbox checked={item.selected} onChange={event => updateCandidate(item.key, { selected: event.target.checked })}>采纳此候选</Checkbox><Select value={item.category} onChange={category => updateCandidate(item.key, { category })} options={assetCategories} /><Input value={item.name} onChange={event => updateCandidate(item.key, { name: event.target.value })} placeholder="名称" /><Input.TextArea rows={3} value={item.prompt} onChange={event => updateCandidate(item.key, { prompt: event.target.value })} placeholder="视觉提示词" /></article>)}</div> : <div className="shuihuo-empty"><p>选择模型并点击“生成候选”，这里会显示可编辑的人物、场景与道具。</p></div>}
    </Modal>
  </section>;
}
