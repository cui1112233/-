import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Select, message } from 'antd';
import { getProductionConfig, listModels, saveProductionConfig } from '../../../shared/api/shuihuoProduction';
import { withDefaultImageModel } from './modelDefaults';

const defaults = {
  characterPrefix: '',
  imagePrefix: '',
  imageSuffix: '',
  videoPrefix: '',
  videoSuffix: '',
  videoGenerationMode: 'image_to_video',
  textModelId: null,
  imageModelId: null,
  videoModelId: null,
  audioModelId: null,
  jianyingDraftDirectory: ''
};

function optionsFor(models, kind) {
  return models.filter(model => model.kind === kind).map(model => ({ value: model.id, label: model.name }));
}

export function EngineSettingsModal({ open, onClose, onSaved }) {
  const [activeTab, setActiveTab] = useState('image');
  const [models, setModels] = useState([]);
  const [config, setConfig] = useState(defaults);
  const [loading, setLoading] = useState(false);
  const imageModels = useMemo(() => optionsFor(models, 'image'), [models]);
  const videoModels = useMemo(() => optionsFor(models, 'video'), [models]);
  const audioModels = useMemo(() => optionsFor(models, 'audio'), [models]);
  const selectedVideoModel = useMemo(() => models.find(model => model.id === config.videoModelId), [config.videoModelId, models]);
  const isYDVideoModel = selectedVideoModel?.adapterKind === 'yd_video';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([getProductionConfig(), listModels()]).then(([savedConfig, modelResult]) => {
      const nextModels = modelResult.models || [];
      setConfig(withDefaultImageModel({ ...defaults, ...savedConfig }, nextModels));
      setModels(nextModels);
    }).catch(error => message.error(error.message || '读取引擎设置失败')).finally(() => setLoading(false));
  }, [open]);

  function updateConfig(patch) { setConfig(current => ({ ...current, ...patch })); }

  async function submit() {
    setLoading(true);
    try {
      const saved = await saveProductionConfig(config);
      message.success('引擎设置已保存');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      message.error(error.message || '保存引擎设置失败');
    } finally {
      setLoading(false);
    }
  }

  return <Modal title="引擎设置" open={open} onCancel={onClose} width={900} className="shuihuo-engine-modal" footer={<><Button onClick={onClose}>取消</Button><Button type="primary" loading={loading} onClick={submit}>确认保存</Button></>}>
    <div className="shuihuo-modal-tabs" role="tablist" aria-label="引擎类型">
      {[['image', '生图引擎'], ['video', '视频引擎'], ['audio', '音频引擎']].map(([key, label]) => <button type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>)}
    </div>
    {activeTab === 'image' ? <div className="shuihuo-engine-form">
      <label><span>模型</span><Select allowClear value={config.imageModelId ?? undefined} onChange={imageModelId => updateConfig({ imageModelId: imageModelId ?? null })} placeholder={imageModels.length ? '选择生图模型' : '没有已启用的生图模型'} options={imageModels} /></label>
      <label><span>提示词前缀</span><Input.TextArea value={config.imagePrefix} rows={3} onChange={event => updateConfig({ imagePrefix: event.target.value })} placeholder="输入提示词前缀" /></label>
      <label><span>提示词后缀</span><Input.TextArea value={config.imageSuffix} rows={3} onChange={event => updateConfig({ imageSuffix: event.target.value })} placeholder="输入提示词后缀" /></label>
      <Alert className="wide" type="info" showIcon message="分镜生图提示词顺序" description="提示词前缀 -> 画面提示词 -> 提示词后缀。人物、场景、道具的已生成图片仅作为当前分镜的参考图发送。" />
    </div> : null}
    {activeTab === 'video' ? <div className="shuihuo-engine-form">
      <label><span>模型</span><Select allowClear value={config.videoModelId ?? undefined} onChange={videoModelId => updateConfig({ videoModelId: videoModelId ?? null })} placeholder={videoModels.length ? '选择视频模型' : '没有已启用的视频模型'} options={videoModels} /></label>
      <label><span>生成方式</span><Select value={config.videoGenerationMode} onChange={videoGenerationMode => updateConfig({ videoGenerationMode })} options={[{ value: 'image_to_video', label: '图生视频' }, { value: 'text_to_video', label: '文生视频' }]} /></label>
      <label><span>提示词前缀</span><Input.TextArea value={config.videoPrefix} rows={3} onChange={event => updateConfig({ videoPrefix: event.target.value })} placeholder="输入提示词前缀" /></label>
      <label><span>提示词后缀</span><Input.TextArea value={config.videoSuffix} rows={3} onChange={event => updateConfig({ videoSuffix: event.target.value })} placeholder="输入提示词后缀" /></label>
      {isYDVideoModel ? <Alert className="wide" type="warning" showIcon message="YD2.0 Mini 仅支持图生视频" description="图生视频会使用本分镜已绑定的预设图或主图片；切换到文生视频后，请选择支持文生视频的模型。" /> : null}
      <Alert className="wide" type="info" showIcon message={config.videoGenerationMode === 'text_to_video' ? '文生视频提示词顺序' : '图生视频提示词顺序'} description={config.videoGenerationMode === 'text_to_video' ? '提示词前缀 -> 人物提示词 -> 场景提示词 -> 道具提示词 -> 视频提示词 -> 提示词后缀。不会发送任何图片。' : '提示词前缀 -> 视频提示词 -> 提示词后缀。会发送当前分镜已绑定的人物、场景、道具图；场景图优先作为主画面。'} />
    </div> : null}
    {activeTab === 'audio' ? <div className="shuihuo-engine-form single">
      <label className="wide"><span>音频引擎</span><Select allowClear value={config.audioModelId ?? undefined} onChange={audioModelId => updateConfig({ audioModelId: audioModelId ?? null })} placeholder={audioModels.length ? '选择音频模型' : '没有已启用的音频模型'} options={audioModels} /></label>
    </div> : null}
  </Modal>;
}
