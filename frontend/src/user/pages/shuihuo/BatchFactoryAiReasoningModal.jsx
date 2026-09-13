import { Alert, Button, Modal, Select, Space, Switch, Tabs, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listPersonalConstraintPrompts, saveBatchSettings } from '../../../shared/api/batchFactoryV11';

const scopeOptions = [
  { value: 'all', label: '全部小说' },
  { value: 'unfinished', label: '未完成小说' },
  { value: 'custom', label: '自定义小说' }
];
const personalPromptCategories = [
  { value: 'prefix', label: '画面前缀词' },
  { value: 'quality', label: '画质约束' },
  { value: 'restriction', label: '画面限制' },
  { value: 'negative', label: '负面提示词' }
];

function emptyModule(enabled = true) {
  return { enabled, presetId: '', presetName: '', presetCategory: '', prompt: '', scope: 'all', bookIds: [] };
}

function normalizeModule(value, enabled) {
  const current = value && typeof value === 'object' ? value : {};
  const presetId = String(current.presetId || '').trim();
  return {
    ...emptyModule(enabled),
    ...current,
    presetId,
    presetName: presetId ? String(current.presetName || '').trim() : '',
    presetCategory: presetId ? String(current.presetCategory || '').trim() : '',
    // A batch keeps the text snapshot that was selected from Personal Center,
    // but never treats arbitrary old in-page text as a selectable preset.
    prompt: presetId ? String(current.prompt || '').trim() : ''
  };
}

function normalizeConfig(value, batch) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    assets: normalizeModule(current.assets, true),
    constraints: normalizeModule(current.constraints, false),
    video: { ...normalizeModule(current.video, true), fixedSingleVideo: current.video?.fixedSingleVideo ?? batch?.settingsState?.patch?.fixedSingleVideo === true },
    visual: normalizeModule(current.visual, false)
  };
}

function ScopeFields({ value, books, onChange }) {
  return <>
    <label className="batch-factory-ai-field"><span>范围</span><Select value={value.scope} onChange={scope => onChange({ scope, bookIds: scope === 'custom' ? value.bookIds : [] })} options={scopeOptions} /></label>
    {value.scope === 'custom' ? <label className="batch-factory-ai-field"><span>指定小说</span><Select mode="multiple" value={value.bookIds} onChange={bookIds => onChange({ bookIds })} placeholder="选择本次使用该规则的小说" options={books.map(book => ({ value: book.id, label: `${book.title || '未命名'} · ${book.bookId || '—'}` }))} /></label> : null}
  </>;
}

function groupedOptions(records) {
  return personalPromptCategories.map(category => ({
    label: category.label,
    options: records.filter(item => item.category === category.value).map(item => ({ value: item.id, label: item.name || '未命名预设' }))
  })).filter(group => group.options.length);
}

function ModuleForm({ module, books, presets, loadingPresets, presetsError, onChange, title, description, children }) {
  const options = useMemo(() => groupedOptions(presets), [presets]);
  const selected = presets.find(item => item.id === module.presetId) || null;
  function choosePreset(presetId) {
    const next = presets.find(item => item.id === presetId);
    onChange(next
      ? { presetId: next.id, presetName: next.name || '未命名预设', presetCategory: next.category, prompt: next.body }
      : { presetId: '', presetName: '', presetCategory: '', prompt: '' });
  }
  return <div className="batch-factory-ai-module">
    <div className="batch-factory-ai-module-head"><div><b>{title}</b><p>{description}</p></div><Switch checked={module.enabled === true} onChange={enabled => onChange({ enabled })} /></div>
    {module.enabled ? <div className="batch-factory-ai-module-body">
      <label className="batch-factory-ai-field"><span>个人中心预设提示词</span><Select allowClear showSearch loading={loadingPresets} value={module.presetId || undefined} onChange={choosePreset} placeholder={loadingPresets ? '正在读取个人中心预设提示词' : '选择个人中心预设提示词'} options={options} optionFilterProp="label" /></label>
      {selected || module.presetId ? <div className="batch-factory-ai-selected-preset"><b>已选择：{selected?.name || module.presetName || '已保存预设'}</b><span>{selected?.body || module.prompt || '该预设正文已变更或被删除；请重新选择。'}</span></div> : <p className="batch-factory-ai-disabled">未选择预设时，本模块不会向 AI 推理传入额外提示词。</p>}
      {presetsError ? <Alert type="warning" showIcon message="个人中心预设提示词读取失败" description={presetsError} /> : null}
      {children}<ScopeFields value={module} books={books} onChange={onChange} />
    </div> : <p className="batch-factory-ai-disabled">当前模块未启用，不会参与本次统一 AI 推理。</p>}
  </div>;
}

export function BatchFactoryAiReasoningModal({ open, batch, books, onClose, onSaved, onRun, running, runAvailable, runReason }) {
  const [config, setConfig] = useState(() => normalizeConfig({}, batch));
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [presetsError, setPresetsError] = useState('');
  const batchID = batch?.id;
  const revision = Number(batch?.settingsState?.revision || 0);
  const bookOptions = useMemo(() => (books || []).filter(book => String(book.sourceText || '').trim()), [books]);

  useEffect(() => {
    if (open) setConfig(normalizeConfig(batch?.settingsState?.patch?.aiPromptConfig, batch));
  }, [open, batch?.id, batch?.settingsState?.revision]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoadingPresets(true);
    setPresetsError('');
    Promise.allSettled(personalPromptCategories.map(category => listPersonalConstraintPrompts(category.value))).then(results => {
      if (!active) return;
      const records = results.flatMap((result, index) => result.status === 'fulfilled'
        ? (Array.isArray(result.value?.prompts) ? result.value.prompts : []).map(item => ({
            id: String(item?.id || '').trim(), name: String(item?.name || '').trim(), body: String(item?.body || '').trim(), category: personalPromptCategories[index].value
          })).filter(item => item.id && item.body)
        : []);
      const failures = results.filter(result => result.status === 'rejected');
      setPresets(records);
      setPresetsError(failures.length ? `${failures.length} 个分类未能读取，请刷新后重试。` : '');
    }).catch(() => {
      if (active) { setPresets([]); setPresetsError('个人中心预设提示词读取失败。'); }
    }).finally(() => { if (active) setLoadingPresets(false); });
    return () => { active = false; };
  }, [open]);

  function patchModule(key, patch) {
    setConfig(current => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function save() {
    if (!batchID) return false;
    setSaving(true);
    try {
      await saveBatchSettings(batchID, {
        patch: {
          aiPromptConfig: config,
          fixedSingleVideo: config.video.fixedSingleVideo === true
        },
        expectedRevision: revision
      });
      await onSaved?.();
      message.success('已保存当前批量选择的个人中心预设提示词。');
      return true;
    } catch (error) {
      message.error(error?.message || '保存 AI 推理配置失败');
      return false;
    } finally { setSaving(false); }
  }

  async function saveAndRun() {
    if (!(await save())) return;
    await onRun?.();
  }

  const shared = { books: bookOptions, presets, loadingPresets, presetsError };
  const items = [
    { key: 'assets', label: '资产设置', children: <ModuleForm {...shared} module={config.assets} onChange={patch => patchModule('assets', patch)} title="人物场景提示词" description="从个人中心选择预设，只约束人物、场景、道具三类资产 Prompt。" /> },
    { key: 'constraints', label: '约束设置', children: <ModuleForm {...shared} module={config.constraints} onChange={patch => patchModule('constraints', patch)} title="生产约束" description="从个人中心选择预设；只有启用且已选择的项参与生成。" /> },
    { key: 'video', label: '视频设置', children: <ModuleForm {...shared} module={config.video} onChange={patch => patchModule('video', patch)} title="视频提示词" description="从个人中心选择预设，只约束 video_desc、动作和运镜。"><label className="batch-factory-ai-field"><span>固定开头</span><Select value={config.video.fixedSingleVideo ? 'single' : 'multiple'} onChange={value => patchModule('video', { fixedSingleVideo: value === 'single' })} options={[{ value: 'single', label: '单个 VIDEO' }, { value: 'multiple', label: '多个 VIDEO' }]} /></label></ModuleForm> },
    { key: 'visual', label: '画面设置', children: <ModuleForm {...shared} module={config.visual} onChange={patch => patchModule('visual', patch)} title="画面提示词" description="默认关闭。从个人中心选择预设，只用于画面图片。" /> }
  ];

  return <Modal title="AI 推理" open={open} onCancel={onClose} width={900} className="batch-factory-ai-modal" destroyOnClose={false} footer={<Space><Button onClick={onClose}>取消</Button><Button loading={saving} onClick={save}>保存当前作品配置</Button><Button type="primary" loading={running} disabled={!runAvailable || saving || running || !bookOptions.length} title={runAvailable ? '先保存选择的预设，再执行统一 AI 推理。' : runReason} onClick={saveAndRun}>保存并统一生成</Button></Space>}>
    <Alert type="info" showIcon message="从个人中心选择预设提示词" description="这里不编辑或新建提示词。选择结果和当时的预设正文会保存到当前批量，用于后续 AI 推理；画面提示词只写入画面图片链路。" />
    <Tabs items={items} />
    {!loadingPresets && !presets.length && !presetsError ? <Alert type="info" showIcon message="个人中心还没有可用预设提示词" description="请先在剧本生成的“我的提示词”中保存预设，再回到这里选择。" /> : null}
    {!runAvailable ? <Alert type="warning" showIcon message="当前不能执行 AI 推理" description={runReason || '请先完成引擎配置。'} /> : null}
  </Modal>;
}
