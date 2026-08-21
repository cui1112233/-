import { ArrowUpOutlined, CheckOutlined, CloudUploadOutlined, DeleteOutlined, EditOutlined, FullscreenOutlined, PictureOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, ScissorOutlined, SettingOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Select, Tag, Tooltip, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { downloadMedia, mergeStoryboard, splitStoryboard, insertStoryboard, setPrimaryMedia } from '../../../shared/api/shuihuoProduction';
import { primaryAudioForSegment } from './mediaPlayback';

function publicMedia(item) { return item?.media || item; }

export function MediaPreview({ media, audioRef }) {
  const [url, setURL] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let objectURL = '';
    setURL('');
    setErrorMessage('');
    downloadMedia(media.id).then(blob => {
      const nextURL = URL.createObjectURL(blob);
      if (cancelled) { URL.revokeObjectURL(nextURL); return; }
      objectURL = nextURL;
      setURL(nextURL);
    }).catch(error => {
      if (!cancelled) {
        setURL('');
        setErrorMessage(error.message || '素材加载失败');
      }
    });
    return () => { cancelled = true; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [media.id, retryKey]);
  if (errorMessage) return <span className="shuihuo-media-preview-error" role="status">素材加载失败<Button type="link" size="small" onClick={() => setRetryKey(value => value + 1)}>重试</Button></span>;
  if (!url) return <span className="shuihuo-muted">读取真实媒体...</span>;
  if (media.kind === 'image') return <img src={url} alt="分镜图片" />;
  if (media.kind === 'audio') return <audio controls ref={audioRef} src={url} aria-label="分镜配音" />;
  return <video controls preload="metadata" src={url} aria-label="分镜视频" />;
}

export function StoryboardRow({ index, segment, assets, speakerOptions = [], media, sourceUnitIds = [], voiceSettings, voiceLabel, imageReady, imageUnavailableReason, videoReady, videoUnavailableReason, audioReady, audioUnavailableReason, narrationGenerating, taskSubmitting, onDataChange, onRefresh, onConfigureVoice, onChangeSpeaker, onExpandField, onBindAssets, onUploadMedia, onPreviewMedia, onGenerateNarration, onTask, onDelete, onInsertAfter }) {
  const [busy, setBusy] = useState(false);
  const audioElements = useRef(new Map());
  const actualMedia = (media || []).map(publicMedia).filter(item => item?.segmentId === segment.id);
  const imageMedia = actualMedia.filter(item => item.kind === 'image');
  const videoMedia = actualMedia.filter(item => item.kind === 'video');
  const audioMedia = actualMedia.filter(item => item.kind === 'audio');
  const primaryAudio = primaryAudioForSegment(actualMedia, segment.id);
  const primaryImage = imageMedia.find(item => item.isPrimary === true);
  const candidateMedia = imageMedia.filter(item => item.id !== primaryImage?.id).slice(0, 4);
  const latestVideo = videoMedia.find(item => item.isPrimary === true) || videoMedia[0];
  const canSplit = sourceUnitIds.length > 1;
  const canCreateVideo = videoReady;
  const voiceConfigured = Boolean(voiceLabel);
  const videoTaskTitle = !videoReady
    ? videoUnavailableReason || '视频生成当前不可用'
    : '创建该分镜的真实图生视频任务。后端会选择场景预设图或分镜主图片。';

  useEffect(() => () => {
    audioElements.current.forEach(audio => audio.pause());
    audioElements.current.clear();
  }, []);

  async function toggleAudioPlayback() {
    if (!primaryAudio) return;
    const audio = audioElements.current.get(primaryAudio.id);
    if (!audio) {
      message.warning('配音正在加载，请稍后再试');
      return;
    }
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch (error) {
      message.error(error.message || '配音播放失败');
    }
  }

  async function mutate(operation, successText) {
    setBusy(true);
    try {
      const result = await operation();
      onDataChange(result);
      message.success(successText);
    } catch (error) {
      message.error(error.message || '分镜操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function selectPrimaryImage(mediaId) {
    setBusy(true);
    try {
      await setPrimaryMedia(mediaId);
      await onRefresh();
      message.success('已设为主图');
    } catch (error) {
      message.error(error.message || '设置主图失败');
    } finally {
      setBusy(false);
    }
  }

  return <div className="shuihuo-workbench-row" role="row">
    <div className="shuihuo-workbench-cell shuihuo-order-cell" role="cell"><strong>{segment.orderIndex || index + 1}</strong><Tooltip title="将本段原文合并到上一分镜"><Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={busy || index === 0} onClick={() => mutate(() => mergeStoryboard(segment.id), '已向上合并分镜')} /></Tooltip><Tooltip title={canSplit ? '按合并前原文单元向下拆分' : '此分镜只有一个原文单元，合并后才可拆分'}><Button size="small" type="text" icon={<ScissorOutlined />} disabled={busy || !canSplit} onClick={() => mutate(() => splitStoryboard(segment.id), '已按原文单元拆分')} /></Tooltip></div>
    <div className="shuihuo-workbench-cell shuihuo-subtitle-cell" role="cell"><p>{segment.subtitleText || segment.sourceText || '未设置字幕'}</p><Tooltip title="编辑字幕"><Button className="shuihuo-inline-edit" type="text" size="small" icon={<EditOutlined />} aria-label="编辑字幕" onClick={() => onExpandField({ segment, field: 'subtitleText', label: '字幕' })} /></Tooltip></div>
    <div className="shuihuo-workbench-cell shuihuo-voice-cell" role="cell"><div className="shuihuo-voice-controls"><Tooltip title={primaryAudio ? '播放或暂停已生成配音' : '暂无可播放的配音；请先重新生成或上传音频'}><Button type="text" size="small" icon={<PlayCircleOutlined />} disabled={!primaryAudio} onClick={toggleAudioPlayback} /></Tooltip><Tooltip title={audioReady ? '直接调用已配置的配音工具并保存到本分镜' : audioUnavailableReason || '配音生成当前不可用'}><Button type="text" size="small" icon={<ReloadOutlined />} loading={narrationGenerating} disabled={!audioReady || narrationGenerating} onClick={() => onGenerateNarration(segment)} /></Tooltip><Button className="shuihuo-voice-config" type="text" size="small" icon={<SettingOutlined />} onClick={() => onConfigureVoice(segment, 'voice')} title={segment.speaker === '旁白' ? '配置旁白音色' : '查看角色音色设置'}><UserOutlined /> {voiceLabel || (voiceConfigured ? '已配置' : '默认音色')}</Button><Button className="shuihuo-voice-value" type="text" size="small" onClick={() => onConfigureVoice(segment, 'speechRate')} title="设置配音语速">x{Number(voiceSettings?.speechRate ?? 1).toFixed(1)}</Button><Button className="shuihuo-voice-value" type="text" size="small" onClick={() => onConfigureVoice(segment, 'pitch')} title="设置配音音调">调 {Number(voiceSettings?.pitch ?? 0)}</Button></div><div className="shuihuo-voice-script" role="button" tabIndex={0} onClick={() => onExpandField({ segment, field: 'subtitleText', label: '配音文案' })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onExpandField({ segment, field: 'subtitleText', label: '配音文案' }); }}><Select size="small" value={segment.speaker || '旁白'} options={speakerOptions.map(value => ({ value, label: value }))} onClick={event => event.stopPropagation()} onChange={speaker => onChangeSpeaker(segment, speaker)} /><span>{segment.subtitleText || segment.sourceText || '未设置配音文案'}</span><FullscreenOutlined /></div><div className="shuihuo-row-audio">{audioMedia.length ? audioMedia.map(item => <MediaPreview key={item.id} media={item} audioRef={element => { if (element) audioElements.current.set(item.id, element); else audioElements.current.delete(item.id); }} />) : null}</div></div>
    <div className="shuihuo-workbench-cell shuihuo-preset-cell" role="cell"><div className="shuihuo-tag-list">{(assets || []).map(asset => <Tag key={asset.id}>{asset.name}</Tag>)}</div><button className="shuihuo-preset-picker" type="button" onClick={() => onBindAssets(segment, 'character')}>添加角色</button><button className="shuihuo-preset-picker" type="button" onClick={() => onBindAssets(segment, 'scene')}>添加场景</button><button className="shuihuo-preset-picker" type="button" onClick={() => onBindAssets(segment, 'prop')}>添加道具</button></div>
    <div className="shuihuo-workbench-cell shuihuo-prompt-cell" role="cell"><div><b>画面提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => onExpandField({ segment, field: 'imagePrompt', label: '图片提示词' })}><span>{segment.imagePrompt || '输入画面提示词...'}</span><FullscreenOutlined /></button></div><div><b>视频提示词</b><button className="shuihuo-prompt-box" type="button" onClick={() => onExpandField({ segment, field: 'videoPrompt', label: '视频提示词' })}><span>{segment.videoPrompt || '输入视频提示词...'}</span><FullscreenOutlined /></button></div></div>
    <div className="shuihuo-workbench-cell shuihuo-library-cell" role="cell"><button className="shuihuo-primary-media" type="button" title={primaryImage ? '查看主图' : '上传主图'} onClick={() => primaryImage ? onPreviewMedia(primaryImage) : onUploadMedia('image', segment)}>{primaryImage ? <MediaPreview media={primaryImage} /> : <><CloudUploadOutlined /><span>上传主图</span></>}</button><div className="shuihuo-media-grid" aria-label="图片候选">{candidateMedia.map(item => <div className="shuihuo-media-candidate" key={item.id}><button className="shuihuo-media-tile" type="button" title="查看候选图" aria-label={`查看候选图 ${item.id}`} onClick={() => onPreviewMedia(item)}><MediaPreview media={item} /></button><Button className="shuihuo-set-primary" type="text" size="small" icon={<CheckOutlined />} title="设为主图" aria-label={`将候选图 ${item.id}设为主图`} onClick={() => selectPrimaryImage(item.id)} /></div>)}{Array.from({ length: Math.max(0, 4 - candidateMedia.length) }).map((_, itemIndex) => <button className="shuihuo-media-tile is-empty" type="button" key={`empty-${itemIndex}`} title="上传图片或视频" onClick={() => onUploadMedia('image', segment)}><PictureOutlined /></button>)}</div>{latestVideo ? <button className="shuihuo-video-preview" type="button" onClick={() => onPreviewMedia(latestVideo)}><VideoCameraOutlined /> 查看生成视频</button> : null}</div>
    <div className="shuihuo-workbench-cell shuihuo-row-actions" role="cell"><Tooltip title={imageReady ? '按引擎配置直接创建该分镜的图片任务' : imageUnavailableReason || '图片生成当前不可用'}><Button type="text" size="small" icon={<PictureOutlined />} loading={taskSubmitting} disabled={!imageReady || taskSubmitting} onClick={() => onTask('image', segment.id)}>重生图</Button></Tooltip><Tooltip title={videoTaskTitle}><Button type="text" size="small" icon={<VideoCameraOutlined />} loading={taskSubmitting} disabled={!canCreateVideo || taskSubmitting} onClick={() => onTask('video', segment.id)}>生成视频</Button></Tooltip><Popconfirm title="删除此分镜？原文单元与已生成媒体不会被删除。" onConfirm={() => mutate(() => onDelete(segment.id), '已删除分镜')}><Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={busy || taskSubmitting}>删除分镜</Button></Popconfirm><Button type="text" size="small" icon={<PlusOutlined />} disabled={busy || taskSubmitting} onClick={() => onInsertAfter(segment)}>后方新增</Button></div>
  </div>;
}
