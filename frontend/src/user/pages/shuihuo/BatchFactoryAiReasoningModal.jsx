import { Alert, Button, Input, Modal, Select, Space, Switch, Tabs, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { saveBatchSettings } from '../../../shared/api/batchFactoryV11';

const scopeOptions = [
  { value: 'all', label: '全部小说' },
  { value: 'unfinished', label: '未完成小说' },
  { value: 'custom', label: '自定义小说' }
];

function emptyModule(enabled = true) {
  return { enabled, prompt: '', scope: 'all', bookIds: [] };
}

function normalizeConfig(value, batch) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    assets: { ...emptyModule(true), ...(current.assets || {}) },
    constraints: { ...emptyModule(false), ...(current.constraints || {}) },
    video: { ...emptyModule(true), ...(current.video || {}), fixedSingleVideo: current.video?.fixedSingleVideo ?? batch?.settingsState?.patch?.fixedSingleVideo === true },
    visual: { ...emptyModule(false), ...(current.visual || {}) }
  };
}

function ScopeFields({ value, books, onChange }) {
  return <>
    <label className="batch-factory-ai-field"><span>范围</span><Select value={value.scope} onChange={scope => onChange({ scope, bookIds: scope === 'custom' ? value.bookIds : [] })} options={scopeOptions} /></label>
    {value.scope === 'custom' ? <label className="batch-factory-ai-field"><span>指定小说</span><Select mode="multiple" value={value.bookIds} onChange={bookIds => onChange({ bookIds })} placeholder="选择本次使用该规则的小说" options={books.map(book => ({ value: book.id, label: `${book.title || '未命名'} · ${book.bookId || '—'}` }))} /></label> : null}
  </>;
}

function ModuleForm({ module, books, onChange, title, description, placeholder, children }) {
  return <div className="batch-factory-ai-module">
    <div className="batch-factory-ai-module-head"><div><b>{title}</b><p>{description}</p></div><Switch checked={module.enabled === true} onChange={enabled => onChange({ enabled })} /></div>
    {module.enabled ? <div className="batch-factory-ai-module-body"><label className="batch-factory-ai-field"><span>提示词</span><Input.TextArea rows={6} value={module.prompt} onChange={event => onChange({ prompt: event.target.value })} placeholder={placeholder} /></label>{children}<ScopeFields value={module} books={books} onChange={onChange} /></div> : <p className="batch-factory-ai-disabled">当前模块未启用，不会参与本次统一 AI 推理。</p>}
  </div>;
}

export function BatchFactoryAiReasoningModal({ open, batch, books, onClose, onSaved, onRun, running, runAvailable, runReason }) {
  const [config, setConfig] = useState(() => normalizeConfig({}, batch));
  const [saving, setSaving] = useState(false);
  const batchID = batch?.id;
  const revision = Number(batch?.settingsState?.revision || 0);
  const bookOptions = useMemo(() => (books || []).filter(book => String(book.sourceText || '').trim()), [books]);

  useEffect(() => {
    if (open) setConfig(normalizeConfig(batch?.settingsState?.patch?.aiPromptConfig, batch));
  }, [open, batch?.id, batch?.settingsState?.revision]);

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
      message.success('AI 推理提示词配置已保存到当前批量。');
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

  const items = [
    { key: 'assets', label: '资产设置', children: <ModuleForm module={config.assets} books={bookOptions} onChange={patch => patchModule('assets', patch)} title="人物场景提示词" description="只约束人物、场景、道具三类资产 Prompt。" placeholder="例如：统一写实国风，人物服饰、年龄和场景材质保持连续。" /> },
    { key: 'constraints', label: '约束设置', children: <ModuleForm module={config.constraints} books={bookOptions} onChange={patch => patchModule('constraints', patch)} title="生产约束" description="启用后约束本次导演输出；只有启用项参与生成。" placeholder="例如：镜头不得跳轴，不要文字、水印、畸形肢体，动作必须可拍可见。" /> },
    { key: 'video', label: '视频设置', children: <ModuleForm module={config.video} books={bookOptions} onChange={patch => patchModule('video', patch)} title="视频提示词" description="只约束分镜 video_desc、动作和运镜，进入最终视频 Prompt。" placeholder="例如：动作连续、镜头克制，明确人物动作、机位和运镜节奏。"><label className="batch-factory-ai-field"><span>固定开头</span><Select value={config.video.fixedSingleVideo ? 'single' : 'multiple'} onChange={value => patchModule('video', { fixedSingleVideo: value === 'single' })} options={[{ value: 'single', label: '单个 VIDEO' }, { value: 'multiple', label: '多个 VIDEO' }]} /></label></ModuleForm> },
    { key: 'visual', label: '画面设置', children: <ModuleForm module={config.visual} books={bookOptions} onChange={patch => patchModule('visual', patch)} title="画面提示词" description="默认关闭。启用后生成每个分镜的画面 Prompt，只用于画面图片。" placeholder="例如：冷色电影光，主体清晰，保持人物构图稳定。" /> }
  ];

  return <Modal title="AI 推理" open={open} onCancel={onClose} width={900} className="batch-factory-ai-modal" destroyOnClose={false} footer={<Space><Button onClick={onClose}>取消</Button><Button loading={saving} onClick={save}>保存当前作品配置</Button><Button type="primary" loading={running} disabled={!runAvailable || saving || running || !bookOptions.length} title={runAvailable ? '先保存四类提示词配置，再执行统一 AI 推理。' : runReason} onClick={saveAndRun}>保存并统一生成</Button></Space>}>
    <Alert type="info" showIcon message="AI 推理只生成资产、画面与视频 Prompt" description="四类配置保存到当前批量；资产、约束、视频规则参与导演生成。画面提示词只写入画面图片链路，绝不混入最终视频提示词。" />
    <Tabs items={items} />
    {!runAvailable ? <Alert type="warning" showIcon message="当前不能执行 AI 推理" description={runReason || '请先完成引擎配置。'} /> : null}
  </Modal>;
}
