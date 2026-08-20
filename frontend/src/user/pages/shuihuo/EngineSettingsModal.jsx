import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Switch, message } from 'antd';
import { getProductionConfig, listModels, saveProductionConfig } from '../../../shared/api/shuihuoProduction';

const defaults = {
  characterPrefix: '',
  imagePrefix: '',
  imageSuffix: '',
  videoPrefix: '',
  videoSuffix: '',
  textModelId: null,
  imageModelId: null,
  videoModelId: null,
  audioModelId: null,
  jianyingDraftDirectory: ''
};

const imageDefaults = {
  modelSource: 'official',
  imageRatio: '9:16',
  resolution: '2K',
  useCharacterReference: true,
  useSceneReference: true
};

const videoDefaults = {
  videoDuration: '5',
  videoRatio: '9:16',
  videoResolution: '720p',
  referenceType: 'all',
  keepSubtitleTiming: true,
  sendCharacterAudio: false
};

const YD_VIDEO_RATIOS = ['9:16', '16:9'];

function optionsFor(models, kind) {
  return models.filter(model => model.kind === kind).map(model => ({ value: model.id, label: model.name }));
}

export function EngineSettingsModal({ open, onClose, onSaved }) {
  const [activeTab, setActiveTab] = useState('image');
  const [models, setModels] = useState([]);
  const [config, setConfig] = useState(defaults);
  const [uiConfig, setUIConfig] = useState({ ...imageDefaults, ...videoDefaults });
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
      setConfig({ ...defaults, ...savedConfig });
      setModels(modelResult.models || []);
    }).catch(error => message.error(error.message || '读取引擎设置失败')).finally(() => setLoading(false));
  }, [open]);

  function updateConfig(patch) { setConfig(current => ({ ...current, ...patch })); }
  function updateUIConfig(patch) { setUIConfig(current => ({ ...current, ...patch })); }

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

  return <Modal title="引擎设置" open={open} onCancel={onClose} width={1100} className="shuihuo-engine-modal" footer={<><Button onClick={onClose}>取消</Button><Button type="primary" loading={loading} onClick={submit}>确认保存</Button></>}>
    <div className="shuihuo-modal-tabs" role="tablist" aria-label="引擎类型">
      {[['image', '生图引擎'], ['video', '视频引擎'], ['audio', '音频引擎']].map(([key, label]) => <button type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>)}
    </div>
    {activeTab === 'image' ? <div className="shuihuo-engine-form">
      <label><span>模型来源</span><Select value={uiConfig.modelSource} onChange={modelSource => updateUIConfig({ modelSource })} options={[{ value: 'official', label: '官网' }, { value: 'custom', label: '自定义' }]} /></label>
      <label><span>模型</span><Select allowClear value={config.imageModelId ?? undefined} onChange={imageModelId => updateConfig({ imageModelId: imageModelId ?? null })} placeholder={imageModels.length ? '选择生图模型' : '没有已启用的生图模型'} options={imageModels} /></label>
      <label><span>提示词前缀</span><Input.TextArea value={config.imagePrefix} rows={3} onChange={event => updateConfig({ imagePrefix: event.target.value })} placeholder="输入提示词前缀" /></label>
      <label><span>提示词后缀</span><Input.TextArea value={config.imageSuffix} rows={3} onChange={event => updateConfig({ imageSuffix: event.target.value })} placeholder="输入提示词后缀" /></label>
      <label><span>模型名称</span><Select value={config.imageModelId ?? undefined} onChange={imageModelId => updateConfig({ imageModelId: imageModelId ?? null })} placeholder="选择模型" options={imageModels} /></label>
      <label><span>图片比例</span><Select value={uiConfig.imageRatio} onChange={imageRatio => updateUIConfig({ imageRatio })} options={['9:16', '16:9', '1:1', '4:3'].map(value => ({ value, label: value }))} /></label>
      <label><span>分辨率</span><Select value={uiConfig.resolution} onChange={resolution => updateUIConfig({ resolution })} options={['720p', '1080p', '2K'].map(value => ({ value, label: value }))} /></label>
      <div className="shuihuo-engine-switches"><label>开启人物垫图<Switch checked={uiConfig.useCharacterReference} onChange={useCharacterReference => updateUIConfig({ useCharacterReference })} /></label><label>开启场景垫图<Switch checked={uiConfig.useSceneReference} onChange={useSceneReference => updateUIConfig({ useSceneReference })} /></label></div>
    </div> : null}
    {activeTab === 'video' ? <div className="shuihuo-engine-form">
      <label><span>模型来源</span><Select value={uiConfig.modelSource} onChange={modelSource => updateUIConfig({ modelSource })} options={[{ value: 'official', label: '官网' }, { value: 'custom', label: '自定义' }]} /></label>
      <label><span>模型</span><Select allowClear value={config.videoModelId ?? undefined} onChange={videoModelId => updateConfig({ videoModelId: videoModelId ?? null })} placeholder={videoModels.length ? '选择视频模型' : '没有已启用的视频模型'} options={videoModels} /></label>
      <label><span>提示词前缀</span><Input.TextArea value={config.videoPrefix} rows={3} onChange={event => updateConfig({ videoPrefix: event.target.value })} placeholder="输入提示词前缀" /></label>
      <label><span>提示词后缀</span><Input.TextArea value={config.videoSuffix} rows={3} onChange={event => updateConfig({ videoSuffix: event.target.value })} placeholder="输入提示词后缀" /></label>
      <label><span>视频模型</span><Select value={config.videoModelId ?? undefined} onChange={videoModelId => updateConfig({ videoModelId: videoModelId ?? null })} placeholder="选择模型" options={videoModels} /></label>
      {isYDVideoModel ? <>
        <label><span>视频时长</span><Input value="固定 1 秒" readOnly /></label>
        <label><span>视频尺寸</span><Select value={uiConfig.videoRatio} onChange={videoRatio => updateUIConfig({ videoRatio })} options={YD_VIDEO_RATIOS.map(value => ({ value, label: value }))} /></label>
        <label><span>视频分辨率</span><Input value="固定 720p" readOnly /></label>
      </> : <>
        <label><span>视频时长</span><Select value={uiConfig.videoDuration} onChange={videoDuration => updateUIConfig({ videoDuration })} options={['5', '8', '10'].map(value => ({ value, label: `${value}秒` }))} /></label>
        <label><span>视频尺寸</span><Select value={uiConfig.videoRatio} onChange={videoRatio => updateUIConfig({ videoRatio })} options={['9:16', '16:9', '1:1'].map(value => ({ value, label: value }))} /></label>
        <label><span>视频分辨率</span><Select value={uiConfig.videoResolution} onChange={videoResolution => updateUIConfig({ videoResolution })} options={['720p', '1080p'].map(value => ({ value, label: value }))} /></label>
      </>}
      <label className="wide"><span>参考类型</span><Select value={uiConfig.referenceType} onChange={referenceType => updateUIConfig({ referenceType })} options={[{ value: 'all', label: '全能参考' }, { value: 'first-frame', label: '首帧参考' }, { value: 'image', label: '图片参考' }]} /></label>
      <div className="shuihuo-engine-switches"><label>参考字幕时长<Switch checked={uiConfig.keepSubtitleTiming} onChange={keepSubtitleTiming => updateUIConfig({ keepSubtitleTiming })} /></label><label>发送角色音频<Switch checked={uiConfig.sendCharacterAudio} onChange={sendCharacterAudio => updateUIConfig({ sendCharacterAudio })} /></label></div>
    </div> : null}
    {activeTab === 'audio' ? <div className="shuihuo-engine-form single">
      <label className="wide"><span>音频引擎</span><Select allowClear value={config.audioModelId ?? undefined} onChange={audioModelId => updateConfig({ audioModelId: audioModelId ?? null })} placeholder={audioModels.length ? '选择音频模型' : '没有已启用的音频模型'} options={audioModels} /></label>
    </div> : null}
  </Modal>;
}
