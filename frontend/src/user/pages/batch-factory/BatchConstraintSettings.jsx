import { Alert, Button, Input, Modal, Popconfirm, Segmented, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import {
  deleteScriptConstraintPrompt,
  getConstraintPresetTexts,
  listScriptConstraintPrompts,
  listScriptPresetCatalog,
  saveScriptConstraintPrompt,
  updateScriptConstraintPrompt
} from '../../../shared/api/generation';
import { resetBatchFactoryItemOverrides, updateBatchFactoryItemOverrides } from '../../../shared/api/batchFactory';

const CATEGORIES = Object.freeze([
  { key: 'prefix', label: '画面前缀词', bodyKey: 'customPrefix', enabledKey: 'constraintPrefixEnabled' },
  { key: 'quality', label: '画质约束', bodyKey: 'quality', enabledKey: 'constraintQualityEnabled' },
  { key: 'restriction', label: '画面限制', bodyKey: 'restriction', enabledKey: 'constraintRestrictionEnabled' },
  { key: 'negative', label: '负面提示词', bodyKey: 'negative', enabledKey: 'constraintNegativeEnabled' }
]);

function metaKeys(category) {
  const name = category[0].toUpperCase() + category.slice(1);
  return {
    source: `constraint${name}Source`,
    preset: `constraint${name}PresetId`,
    personal: `constraint${name}PersonalPromptId`
  };
}

function layerFromSettings(settings, category) {
  const definition = CATEGORIES.find(item => item.key === category);
  const keys = metaKeys(category);
  const source = ['system', 'personal', 'draft'].includes(settings?.[keys.source])
    ? settings[keys.source]
    : (settings?.[keys.personal] ? 'personal' : (settings?.[keys.preset] ? 'system' : 'system'));
  const explicitEnabled = settings?.[definition.enabledKey];
  return {
    enabled: typeof explicitEnabled === 'boolean' ? explicitEnabled : category === 'prefix',
    source,
    presetId: String(settings?.[keys.preset] || ''),
    personalPromptId: String(settings?.[keys.personal] || ''),
    body: String(settings?.[definition.bodyKey] || '')
  };
}

function layerPatch(category, patch) {
  const definition = CATEGORIES.find(item => item.key === category);
  const keys = metaKeys(category);
  const next = {};
  if (Object.hasOwn(patch, 'enabled')) next[definition.enabledKey] = Boolean(patch.enabled);
  if (Object.hasOwn(patch, 'source')) next[keys.source] = patch.source;
  if (Object.hasOwn(patch, 'presetId')) next[keys.preset] = patch.presetId || '';
  if (Object.hasOwn(patch, 'personalPromptId')) next[keys.personal] = patch.personalPromptId || '';
  if (Object.hasOwn(patch, 'body')) next[definition.bodyKey] = patch.body || '';
  if (category === 'prefix') {
    const selectedPreset = Object.hasOwn(patch, 'presetId') && Boolean(patch.presetId);
    const selectedPersonal = Object.hasOwn(patch, 'personalPromptId') && Boolean(patch.personalPromptId);
    const editedBody = Object.hasOwn(patch, 'body') && Boolean(String(patch.body || '').trim());
    if (selectedPreset || selectedPersonal || editedBody) next.prefixMode = 'manual';
  }
  return next;
}

function hasAnyKey(value, keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(value || {}, key));
}

function overrideCount(value) {
  const override = value && typeof value === 'object' ? value : {};
  let count = 0;
  if (hasAnyKey(override, ['injectCharacterPrompt', 'injectScenePrompt'])) count += 1;
  for (const definition of CATEGORIES) {
    const keys = metaKeys(definition.key);
    if (hasAnyKey(override, [definition.enabledKey, definition.bodyKey, keys.source, keys.preset, keys.personal, ...(definition.key === 'prefix' ? ['prefixMode'] : [])])) count += 1;
  }
  return count;
}

export function BatchConstraintEditor({ value, onChange, scopeLabel = '' }) {
  const settings = value || {};
  const [catalog, setCatalog] = useState([]);
  const [presetTexts, setPresetTexts] = useState({});
  const [personal, setPersonal] = useState({});
  const [loadingPersonal, setLoadingPersonal] = useState({});
  const [savingCategory, setSavingCategory] = useState('');
  const [nameModal, setNameModal] = useState({ open: false, category: '', name: '', editingId: '' });

  useEffect(() => {
    let active = true;
    listScriptPresetCatalog()
      .then(result => { if (active) setCatalog(Array.isArray(result?.catalog) ? result.catalog : []); })
      .catch(() => { if (active) message.warning('约束系统预设加载失败'); });
    for (const { key } of CATEGORIES) loadPersonal(key, active);
    return () => { active = false; };
  }, []);

  async function loadPersonal(category, active = true) {
    setLoadingPersonal(current => ({ ...current, [category]: true }));
    try {
      const result = await listScriptConstraintPrompts(category);
      if (active) setPersonal(current => ({ ...current, [category]: Array.isArray(result?.prompts) ? result.prompts : [] }));
    } catch (_) {
      if (active) setPersonal(current => ({ ...current, [category]: [] }));
    } finally {
      if (active) setLoadingPersonal(current => ({ ...current, [category]: false }));
    }
  }

  function systemOptions(category) {
    return catalog
      .filter(item => item.constraintCategory === category)
      .map(item => ({ label: item.name, value: item.id }));
  }

  function patchLayer(category, patch) {
    onChange(layerPatch(category, patch));
  }

  async function selectSystem(category, presetId) {
    if (!presetId) {
      patchLayer(category, { source: 'system', presetId: '', personalPromptId: '' });
      return;
    }
    let body = String(presetTexts[presetId] || '').trim();
    if (!body) {
      try {
        const result = await getConstraintPresetTexts([presetId]);
        body = String(result?.texts?.[presetId] || '').trim();
        setPresetTexts(current => ({ ...current, ...(result?.texts || {}) }));
      } catch (_) {
        return message.warning('系统预设提示词读取失败');
      }
    }
    patchLayer(category, { source: 'system', presetId, personalPromptId: '', body });
  }

  function selectPersonal(category, promptId) {
    const prompt = (personal[category] || []).find(item => item.id === promptId);
    if (!prompt) {
      patchLayer(category, { source: 'draft', presetId: '', personalPromptId: '' });
      return;
    }
    patchLayer(category, { source: 'personal', presetId: '', personalPromptId: prompt.id, body: prompt.body || '' });
  }

  function saveDraft(category) {
    const layer = layerFromSettings(settings, category);
    if (!layer.body.trim()) return message.warning('请先填写提示词内容');
    patchLayer(category, { source: 'draft', presetId: '', personalPromptId: '' });
    message.success('当前草稿已保留在本次设置中');
  }

  function openSaveNamed(category, prompt = null) {
    setNameModal({
      open: true,
      category,
      name: prompt?.name || '',
      editingId: prompt?.id || ''
    });
  }

  async function saveNamed() {
    const category = nameModal.category;
    const layer = layerFromSettings(settings, category);
    const name = String(nameModal.name || '').trim();
    if (!name) return message.warning('请输入提示词名称');
    if (!layer.body.trim()) return message.warning('请先填写提示词内容');
    setSavingCategory(category);
    try {
      const result = nameModal.editingId
        ? await updateScriptConstraintPrompt(nameModal.editingId, { name, body: layer.body })
        : await saveScriptConstraintPrompt({ category, name, body: layer.body });
      const saved = result?.prompt;
      if (!saved) throw new Error('保存失败');
      await loadPersonal(category);
      patchLayer(category, { source: 'personal', presetId: '', personalPromptId: saved.id, body: saved.body || layer.body });
      setNameModal({ open: false, category: '', name: '', editingId: '' });
      message.success(nameModal.editingId ? '个人提示词已更新' : '已保存为我的提示词');
    } catch (error) {
      message.error(error.message || '提示词保存失败');
    } finally {
      setSavingCategory('');
    }
  }

  async function removePersonal(category, id) {
    try {
      await deleteScriptConstraintPrompt(id);
      await loadPersonal(category);
      const layer = layerFromSettings(settings, category);
      if (layer.personalPromptId === id) patchLayer(category, { source: 'draft', personalPromptId: '' });
      message.success('已删除我的提示词');
    } catch (error) {
      message.error(error.message || '删除失败');
    }
  }

  const basicEnabled = settings.injectCharacterPrompt !== false && settings.injectScenePrompt !== false;

  return <div className="batch-constraint-editor">
    {scopeLabel ? <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{scopeLabel}</Typography.Text> : null}
    <div className="script-constraint-section batch-constraint-basic">
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Typography.Text strong>基础设定（人物 / 场景）</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 3 }}>
            开启后，根据当前 VIDEO 引用自动加入对应人物设定和场景设定。
          </Typography.Text>
        </div>
        <Switch checked={basicEnabled} onChange={enabled => onChange({ injectCharacterPrompt: enabled, injectScenePrompt: enabled })} />
      </Space>
    </div>

    {CATEGORIES.map(definition => {
      const layer = layerFromSettings(settings, definition.key);
      const isSystem = layer.source === 'system';
      const selectedPersonal = (personal[definition.key] || []).find(item => item.id === layer.personalPromptId);
      return <div className="script-constraint-section" key={definition.key}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong>{definition.label}</Typography.Text>
          <Switch checked={layer.enabled} onChange={enabled => patchLayer(definition.key, { enabled })} />
        </Space>
        {layer.enabled ? <>
          <Segmented
            block
            value={isSystem ? 'system' : 'personal'}
            options={[{ label: '系统预设', value: 'system' }, { label: '我的提示词', value: 'personal' }]}
            onChange={source => patchLayer(definition.key, source === 'system'
              ? { source: 'system', personalPromptId: '' }
              : { source: layer.personalPromptId ? 'personal' : 'draft', presetId: '' })}
            style={{ marginTop: 10 }}
          />
          {isSystem ? <Select
            allowClear
            placeholder="选择系统预设"
            options={systemOptions(definition.key)}
            value={layer.presetId || undefined}
            onChange={presetId => selectSystem(definition.key, presetId)}
            style={{ width: '100%', marginTop: 8 }}
          /> : <>
            <Select
              allowClear
              loading={loadingPersonal[definition.key]}
              placeholder="选择我的提示词，或直接编辑当前草稿"
              options={(personal[definition.key] || []).map(item => ({ label: item.name || '未命名个人提示词', value: item.id }))}
              value={layer.personalPromptId || undefined}
              onChange={promptId => selectPersonal(definition.key, promptId)}
              style={{ width: '100%', marginTop: 8 }}
            />
            {selectedPersonal ? <Space size={8} wrap style={{ marginTop: 8 }}>
              <Button size="small" onClick={() => openSaveNamed(definition.key, selectedPersonal)}>编辑所选提示词</Button>
              <Popconfirm title="确认删除该个人提示词？" onConfirm={() => removePersonal(definition.key, selectedPersonal.id)}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            </Space> : null}
          </>}
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>提示词内容</Typography.Text>
          <Input.TextArea
            rows={6}
            value={layer.body}
            placeholder="选择系统预设后可在此继续编辑；编辑只影响当前设置，不会修改系统预设。"
            onChange={event => patchLayer(definition.key, { source: 'draft', personalPromptId: '', body: event.target.value })}
            style={{ marginTop: 6 }}
          />
          <Space wrap style={{ marginTop: 10 }}>
            <Button loading={savingCategory === definition.key} onClick={() => saveDraft(definition.key)}>保存当前草稿</Button>
            <Button type="primary" loading={savingCategory === definition.key} onClick={() => openSaveNamed(definition.key)}>保存为我的提示词</Button>
          </Space>
        </> : null}
      </div>;
    })}

    <Modal
      title={nameModal.editingId ? '编辑我的提示词' : '保存为我的提示词'}
      open={nameModal.open}
      onCancel={() => setNameModal({ open: false, category: '', name: '', editingId: '' })}
      onOk={saveNamed}
      confirmLoading={Boolean(savingCategory)}
      okText="保存"
      cancelText="取消"
    >
      <Input
        autoFocus
        maxLength={80}
        placeholder="请输入提示词名称"
        value={nameModal.name}
        onChange={event => setNameModal(current => ({ ...current, name: event.target.value }))}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        保存后会进入“我的提示词”，下次在剧本生成和批量工厂里都可以继续选择使用。
      </Typography.Paragraph>
    </Modal>
  </div>;
}

export function BatchBookConstraintModal({ open, batch, item, onClose, onSaved }) {
  const [draft, setDraft] = useState({});
  const [patch, setPatch] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({ ...(batch?.settings || {}), ...(item?.settingsOverride || {}) });
    setPatch({});
  }, [open, item?.id]);

  function change(nextPatch) {
    setDraft(current => ({ ...current, ...nextPatch }));
    setPatch(current => ({ ...current, ...nextPatch }));
  }

  async function save() {
    if (!Object.keys(patch).length) return onClose();
    setSaving(true);
    try {
      await updateBatchFactoryItemOverrides(batch.id, item.id, patch);
      await onSaved();
      message.success('当前小说约束设置已保存');
      onClose();
    } catch (error) {
      message.error(error.message || '保存当前小说约束失败');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await resetBatchFactoryItemOverrides(batch.id, item.id);
      await onSaved();
      message.success('已恢复跟随批次统一设置');
      onClose();
    } catch (error) {
      message.error(error.message || '恢复批次设置失败');
    } finally {
      setSaving(false);
    }
  }

  const count = overrideCount(item?.settingsOverride);
  return <Modal
    title="约束设置"
    width={720}
    open={open}
    onCancel={onClose}
    footer={<Space>
      {count ? <Button disabled={saving} onClick={reset}>恢复批次设置</Button> : null}
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" loading={saving} onClick={save}>保存本次设置</Button>
    </Space>}
  >
    <Alert
      type={count ? 'info' : 'success'}
      showIcon
      message={count ? `当前小说已单独修改 ${count} 项` : '当前小说跟随批次统一设置'}
      description={count ? '只覆盖这里实际修改的项目，其余约束继续继承生产统一设置。' : '修改任一开关或提示词后，只会影响当前小说。'}
      style={{ marginBottom: 12 }}
    />
    <BatchConstraintEditor value={draft} onChange={change} scopeLabel={`当前小说：${item?.title || '未命名小说'}`} />
  </Modal>;
}

export function BatchConstraintSummary({ settings, override }) {
  const effective = { ...(settings || {}), ...(override || {}) };
  const enabled = [
    effective.injectCharacterPrompt !== false && effective.injectScenePrompt !== false,
    effective.constraintPrefixEnabled !== false,
    effective.constraintQualityEnabled === true,
    effective.constraintRestrictionEnabled === true,
    effective.constraintNegativeEnabled === true
  ].filter(Boolean).length;
  const count = overrideCount(override);
  return <Space size={6} wrap>
    <Tag color={count ? 'purple' : 'default'}>{count ? `已单独修改 ${count} 项` : '继承批次'}</Tag>
    <Typography.Text type="secondary">约束启用 {enabled}/5</Typography.Text>
  </Space>;
}
