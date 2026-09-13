import { Alert, Button, Modal, Select, Space, Switch, Tabs, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { listBatchFactorySystemPresets, saveBatchSettings } from '../../../shared/api/batchFactoryV11';

const scopeOptions = [
  { value: 'all', label: '全部小说' },
  { value: 'unfinished', label: '未完成小说' },
  { value: 'custom', label: '自定义小说' }
];

const slotLabels = {
  'batch.hook-adaptation': '爆款开头改编',
  'batch.original-director': '原文直转导演',
  'batch.viral-director': '爆款开头导演',
  'batch.character-meta': '人物提示词',
  'batch.scene-meta': '场景提示词',
  'batch.video-meta': '视频提示词',
  'batch.prefix': '视频风格前缀'
};

function emptyModule(enabled = true) {
  return { enabled, presetId: '', presetName: '', presetSlot: '', presetVersion: null, scope: 'all', bookIds: [] };
}

function normalizeModule(value, enabled) {
  const current = value && typeof value === 'object' ? value : {};
  const { prompt: _protectedPrompt, presetCategory: _legacyCategory, ...safeCurrent } = current;
  const presetId = String(safeCurrent.presetId || '').trim();
  return {
    ...emptyModule(enabled),
    ...safeCurrent,
    presetId,
    presetName: presetId ? String(safeCurrent.presetName || '').trim() : '',
    presetSlot: presetId ? String(safeCurrent.presetSlot || '').trim() : '',
    presetVersion: presetId && Number.isInteger(Number(safeCurrent.presetVersion)) ? Number(safeCurrent.presetVersion) : null
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
  const groups = new Map();
  for (const item of records) {
    const slot = String(item.slot || '').trim();
    const label = slotLabels[slot] || '批量工厂预设词';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ value: item.id, label: `${item.name || '未命名预设'}（v${item.version || 1}）` });
  }
  return [...groups.entries()].map(([label, options]) => ({ label, options }));
}

function ModuleForm({ module, books, presets, loadingPresets, presetsError, onChange, title, description, children }) {
  const options = useMemo(() => groupedOptions(presets), [presets]);
  const selected = presets.find(item => item.id === module.presetId) || null;
  function choosePreset(presetId) {
    const next = presets.find(item => item.id === presetId);
    onChange(next
      ? { presetId: next.id, presetName: next.name || '未命名预设', presetSlot: next.slot || '', presetVersion: next.version || 1 }
      : { presetId: '', presetName: '', presetSlot: '', presetVersion: null });
  }
  const selectedName = selected?.name || module.presetName;
  const selectedSlot = selected?.slot || module.presetSlot;
  const selectedVersion = selected?.version || module.presetVersion;
  return <div className="batch-factory-ai-module">
    <div className="batch-factory-ai-module-head"><div><b>{title}</b><p>{description}</p></div><Switch checked={module.enabled === true} onChange={enabled => onChange({ enabled })} /></div>
    {module.enabled ? <div className="batch-factory-ai-module-body">
      <label className="batch-factory-ai-field"><span>个人中心系统预设词（批量工厂）</span><Select allowClear showSearch loading={loadingPresets} value={module.presetId || undefined} onChange={choosePreset} placeholder={loadingPresets ? '正在读取系统预设词' : '选择已发布的批量工厂预设词'} options={options} optionFilterProp="label" /></label>
      {selectedName ? <div className="batch-factory-ai-selected-preset"><b>已选择：{selectedName}{selectedVersion ? `（v${selectedVersion}）` : ''}</b><span>{slotLabels[selectedSlot] || '批量工厂系统预设词'}。预设正文受保护，只会在服务端统一 AI 推理时应用。</span></div> : <p className="batch-factory-ai-disabled">未选择预设时，本模块不会向 AI 推理传入额外提示词。</p>}
      {presetsError ? <Alert type="warning" showIcon message="批量工厂系统预设词读取失败" description={presetsError} /> : null}
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
    listBatchFactorySystemPresets().then(result => {
      if (!active) return;
      setPresets((Array.isArray(result?.catalog) ? result.catalog : []).filter(item => item?.id && item?.module === 'batch-factory'));
    }).catch(() => {
      if (active) { setPresets([]); setPresetsError('个人中心的批量工厂系统预设词读取失败。'); }
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
      message.success('已保存当前批量选择的系统预设词。');
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
    { key: 'assets', label: '资产设置', children: <ModuleForm {...shared} module={config.assets} onChange={patch => patchModule('assets', patch)} title="人物场景提示词" description="选择个人中心的批量工厂系统预设词，约束人物、场景、道具资产。" /> },
    { key: 'constraints', label: '约束设置', children: <ModuleForm {...shared} module={config.constraints} onChange={patch => patchModule('constraints', patch)} title="生产约束" description="选择个人中心的批量工厂系统预设词；只有启用且已选择的项参与生成。" /> },
    { key: 'video', label: '视频设置', children: <ModuleForm {...shared} module={config.video} onChange={patch => patchModule('video', patch)} title="视频提示词" description="选择个人中心的批量工厂系统预设词，只约束 video_desc、动作和运镜。"><label className="batch-factory-ai-field"><span>固定开头</span><Select value={config.video.fixedSingleVideo ? 'single' : 'multiple'} onChange={value => patchModule('video', { fixedSingleVideo: value === 'single' })} options={[{ value: 'single', label: '单个 VIDEO' }, { value: 'multiple', label: '多个 VIDEO' }]} /></label></ModuleForm> },
    { key: 'visual', label: '画面设置', children: <ModuleForm {...shared} module={config.visual} onChange={patch => patchModule('visual', patch)} title="画面提示词" description="默认关闭。选择个人中心的批量工厂系统预设词，只用于画面图片。" /> }
  ];

  return <Modal title="AI 推理" open={open} onCancel={onClose} width={900} className="batch-factory-ai-modal" destroyOnClose={false} footer={<Space><Button onClick={onClose}>取消</Button><Button loading={saving} onClick={save}>保存当前作品配置</Button><Button type="primary" loading={running} disabled={!runAvailable || saving || running || !bookOptions.length} title={runAvailable ? '先保存选择的系统预设词，再执行统一 AI 推理。' : runReason} onClick={saveAndRun}>保存并统一生成</Button></Space>}>
    <Alert type="info" showIcon message="从个人中心的系统预设词选择" description="这里只选择“批量工厂”分类中已发布的版本，不编辑、不展示预设正文。保存时由服务端保存受保护的执行快照，画面提示词仍只进入画面图片链路。" />
    <Tabs items={items} />
    {!loadingPresets && !presets.length && !presetsError ? <Alert type="info" showIcon message="个人中心还没有可用的批量工厂系统预设词" description="请先在个人中心的“系统预设词 → 批量工厂”创建并发布预设版本，再回到这里选择。" /> : null}
    {!runAvailable ? <Alert type="warning" showIcon message="当前不能执行 AI 推理" description={runReason || '请先完成引擎配置。'} /> : null}
  </Modal>;
}
