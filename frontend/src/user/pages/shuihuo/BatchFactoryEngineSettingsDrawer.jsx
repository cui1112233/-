import { Alert, Button, Divider, Input, Modal, Segmented, Select, Space, Switch, Tabs } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { getCapabilities, getPublishCredential } from '../../../shared/api/batchFactoryV11';
import { listAvailableModels } from '../../../shared/api/modelCatalog';

const providerOptions = [
  { value: 'personal_api', label: '个人中心 API' },
  { value: 'doubao_local_executor', label: '豆包本地执行器' },
  { value: 'autodl_comfyui', label: 'AutoDL ComfyUI' }
];
function Field({ label, children, note }) {
  return <label className="batch-factory-engine-field"><span><b>{label}</b>{note ? <small>{note}</small> : null}</span>{children}</label>;
}

export function BatchFactoryEngineSettingsDrawer({ open, batch, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [environment, setEnvironment] = useState(null);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  useEffect(() => { if (open) setForm(batch?.settingsState?.patch || {}); }, [open, batch?.id, batch?.settingsState?.revision]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setModelsLoading(true);
    setModelsError('');
    Promise.all([
      listAvailableModels('image'),
      listAvailableModels('text'),
      listAvailableModels('video')
    ]).then(([imageModels, textModels, videoModels]) => {
      if (active) setModels([...imageModels, ...textModels, ...videoModels]);
    }).catch(error => {
      if (active) {
        setModels([]);
        setModelsError(error?.message || '未能读取个人中心已启用模型');
      }
    }).finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [open]);
  const modelOptions = useMemo(() => ({
    image: models.filter(model => model.kind === 'image').map(model => ({ value: model.id, label: model.name || model.id })),
    text: models.filter(model => model.kind === 'text').map(model => ({ value: model.id, label: model.name || model.id })),
    video: models.filter(model => model.kind === 'video').map(model => ({ value: model.id, label: model.name || model.id }))
  }), [models]);
  function modelPlaceholder(kind, label) {
    if (modelsLoading) return '正在读取个人中心模型…';
    return modelOptions[kind].length ? `选择已启用${label}模型` : `个人中心没有已启用${label}模型`;
  }
  function patch(next) { setForm(current => ({ ...current, ...next })); }
  async function save() {
    setSaving(true);
    try { const saved = await onSave(form); if (saved) onClose(); } finally { setSaving(false); }
  }
  async function selfCheck() {
    setChecking(true);
    try {
      const capabilities = await getCapabilities();
      const publish = capabilities?.['publish.121'] || {};
      if (!publish.available) {
        setEnvironment({ publish, credential: {} });
        return;
      }
      const credential = await getPublishCredential('121');
      setEnvironment({ publish, credential: credential?.credential || credential || {} });
    } catch (error) { setEnvironment({ error: error?.message || '环境自检失败' }); } finally { setChecking(false); }
  }
  const publish = form.publishSettings || {};
  return <Modal title="引擎配置" open={open} onCancel={onClose} width={900} destroyOnClose={false} className="shuihuo-engine-modal batch-factory-engine-modal" footer={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存当前作品配置</Button></Space>}>
    <Tabs items={[
      { key: 'models', label: '模型配置', children: <div className="batch-factory-engine-drawer"><Alert type="info" showIcon message="配置只写入当前批量作品" description="账号、API Key 和供应商地址由个人中心或管理端保存；这里仅选择已授权的模型和生产策略。" />
        <Divider orientation="left">视频</Divider>
        <Field label="视频引擎"><Select value={form.videoProvider || 'personal_api'} options={providerOptions} onChange={videoProvider => patch({ videoProvider })} /></Field>
        <Field label="视频模型" note="从个人中心已启用的视频模型选择"><Select allowClear loading={modelsLoading} value={form.videoModelId || undefined} options={modelOptions.video} placeholder={modelPlaceholder('video', '视频')} onChange={videoModelId => patch({ videoModelId: videoModelId || '' })} /></Field>
        <Field label="VIDEO 时长策略"><Segmented value={form.durationMode || 'auto'} options={[{ value: 'auto', label: 'AI 自动' }, { value: 'model-max', label: '按模型上限' }]} onChange={durationMode => patch({ durationMode })} /></Field>
        <Field label="画幅"><Segmented value={form.aspectRatio || '9:16'} options={['9:16', '16:9', '1:1']} onChange={aspectRatio => patch({ aspectRatio })} /></Field>
        <Field label="固定开头"><Segmented value={form.fixedSingleVideo === true ? 'single' : 'multiple'} options={[{ value: 'single', label: '单个 VIDEO' }, { value: 'multiple', label: '多个 VIDEO' }]} onChange={value => patch({ fixedSingleVideo: value === 'single' })} /></Field>
        <Divider orientation="left">图片与文本</Divider>
        <Field label="图片模型" note="可留空以继承账号默认设置"><Select allowClear loading={modelsLoading} value={form.imageModelId || undefined} options={modelOptions.image} placeholder={modelPlaceholder('image', '图片')} onChange={imageModelId => patch({ imageModelId: imageModelId || '' })} /></Field>
        <Field label="文本模型" note="用于 AI 推理"><Select allowClear loading={modelsLoading} value={form.textModelId || undefined} options={modelOptions.text} placeholder={modelPlaceholder('text', '文本')} onChange={textModelId => patch({ textModelId: textModelId || '' })} /></Field>
        {modelsError ? <Alert type="warning" showIcon message="模型目录暂不可用" description={modelsError} /> : null}
        {!modelsLoading && !modelsError && !models.length ? <Alert type="warning" showIcon message="个人中心没有已启用模型" description={<Space direction="vertical"><span>请先在个人中心按文本、图片、视频类型新增并启用模型，再返回当前批量作品选择。</span><Button type="link" href="/api-config">前往个人中心配置模型</Button></Space>} /> : null}
      </div> },
      { key: 'publish', label: '发布统一', children: <div className="batch-factory-engine-drawer"><Alert type="info" showIcon message="维护网站提交配置，不会直接提交小说" description="真正外部提交只从顶部“上传网络 → 提交选中 / 提交全部”发起。" />
        <Divider orientation="left">版本对应配置档</Divider>
        <Field label="配置档名称" note="保存后回读到当前作品"><Input value={publish.versionProfile || ''} onChange={event => patch({ publishSettings: { ...publish, versionProfile: event.target.value } })} placeholder="例如：121-女频-短剧版" /></Field>
        <Field label="网站风格类型"><Input value={publish.styleType || ''} onChange={event => patch({ publishSettings: { ...publish, styleType: event.target.value } })} placeholder="由网站同步后选择" /></Field>
        <Field label="上传视频类型"><Segmented value={publish.uploadVideoType || 'merged'} options={[{ value: 'merged', label: '合并成品' }, { value: 'individual', label: '独立 VIDEO' }]} onChange={uploadVideoType => patch({ publishSettings: { ...publish, uploadVideoType } })} /></Field>
        <Field label="改文后上传"><Switch checked={form.publishRewriteEnabled === true} onChange={publishRewriteEnabled => patch({ publishRewriteEnabled })} /></Field>
        <Divider orientation="left">环境与同步</Divider>
        <Space wrap><Button onClick={selfCheck} loading={checking}>环境自检</Button><Button disabled title="V11 尚未提供 121 配置档同步接口">同步网站配置档</Button><Button disabled title="V11 尚未提供 121 风格类型同步接口">同步网站风格类型</Button></Space>
        {environment?.error ? <Alert type="error" showIcon message="环境自检失败" description={environment.error} /> : null}
        {environment && !environment.error ? <Alert type={environment.publish?.available && environment.credential?.configured ? 'success' : 'warning'} showIcon message={environment.publish?.available && environment.credential?.configured ? '121 环境具备生成确认单条件' : '121 环境尚未满足提交条件'} description={<Space direction="vertical"><span>通道：{environment.publish?.available ? '已启用' : environment.publish?.reason || '未启用'}</span><span>账号：{environment.credential?.configured ? `已配置 ${environment.credential?.name || ''}` : '未配置'}</span></Space>} /> : null}
        <p className="batch-factory-engine-note">同步按钮保持关闭，直到 V11 后端接入真实 121 回读接口；不会使用本地假数据伪装同步成功。</p>
      </div> }
    ]} />
  </Modal>;
}
