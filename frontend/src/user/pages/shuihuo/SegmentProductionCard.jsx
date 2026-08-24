import { useEffect, useState } from 'react';
import { Button, Popconfirm, Tag, message } from 'antd';
import { downloadMedia } from '../../../shared/api/shuihuoProduction';
import { dispatchCmSelection } from '../../../shared/pet/cmBridge';

function MediaThumbnail({ media, label }) {
  const [url, setURL] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectURL = '';
    setURL('');
    downloadMedia(media.id).then(blob => {
      const nextURL = URL.createObjectURL(blob);
      if (cancelled) { URL.revokeObjectURL(nextURL); return; }
      objectURL = nextURL;
      setURL(nextURL);
    }).catch(() => { if (!cancelled) setURL(''); });
    return () => { cancelled = true; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [media.id]);

  if (!url) return <span className="shuihuo-muted">读取素材...</span>;
  if (media.kind === 'image') return <img src={url} alt={label} />;
  if (media.kind === 'audio') return <audio controls src={url} aria-label={label} />;
  return <video preload="metadata" src={url} aria-label={label} />;
}

function PromptContent({ prompt, locked, onEdit }) {
  return <>
    <p className="shuihuo-production-prompt">{prompt || '未设置'}</p>
    <div className="shuihuo-production-column-actions">
      {locked ? <Tag>已锁定</Tag> : <span className="shuihuo-muted">未锁定</span>}
      <Button type="link" size="small" onClick={onEdit}>编辑</Button>
    </div>
  </>;
}

export function splitSegmentMedia(media) {
  return {
    images: media.filter(item => item.kind === 'image'),
    videos: media.filter(item => item.kind === 'video'),
    audio: media.filter(item => item.kind === 'audio')
  };
}

function MediaContent({ kind, items, index, onSetPrimary, onDeleteMedia, onPreviewMedia, onDownloadMedia, onUpload }) {
  const label = kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '视频';
  const setPrimaryMedia = mediaId => onSetPrimary(mediaId);

  async function handleDownload(media) {
    try {
      const blob = await downloadMedia(media.id);
      onDownloadMedia(media, blob);
    } catch (error) { message.error(error.message || '下载素材失败'); }
  }

  return <>
    <div className="shuihuo-production-media-list">
      {items.map(media => <div key={media.id} className="shuihuo-production-media">
        <MediaThumbnail media={media} label={`分段 ${index + 1} ${label}`} />
        <div className="shuihuo-production-media-actions">
          <Button type="link" size="small" onClick={() => onPreviewMedia(media)} aria-label={`预览${label}`}>预览</Button>
          <Button type="link" size="small" onClick={() => handleDownload(media)} aria-label={`下载${label}`}>下载</Button>
          {kind === 'image' ? <Button type="link" size="small" onClick={() => setPrimaryMedia(media.id)}>{media.isPrimary ? '当前主图' : '设为主图'}</Button> : null}
          <Popconfirm title="删除这个素材？" onConfirm={() => onDeleteMedia(media.id)}>
            <Button type="link" danger size="small" aria-label={`删除${label}`}>删除</Button>
          </Popconfirm>
        </div>
      </div>)}
      {!items.length ? <span className="shuihuo-muted">暂无{label}</span> : null}
    </div>
    {kind !== 'audio' ? <Button type="link" size="small" onClick={() => onUpload(kind)}>上传{label}</Button> : null}
  </>;
}

export function SegmentProductionCard({
  index,
  segment,
  assets,
  media,
  onEdit,
  onBindAssets,
  onSetPrimary,
  onDeleteMedia,
  onPreviewMedia,
  onDownloadMedia,
  onUploadMedia,
  onMove,
  onDelete
}) {
  const { images: imageMedia, audio: audioMedia, videos: videoMedia } = splitSegmentMedia(media);

  function focusSegment() {
    dispatchCmSelection({
      type: 'segment',
      id: segment.id || `segment-${index + 1}`,
      label: `分段 ${index + 1}`,
      meta: {
        index,
        sourceText: segment.sourceText || '',
        subtitleText: segment.subtitleText || '',
        imagePrompt: segment.imagePrompt || '',
        videoPrompt: segment.videoPrompt || '',
        assetIds: assets.map(asset => asset.id)
      }
    });
  }

  return <article className="shuihuo-production-card" tabIndex={0} onClick={focusSegment} onFocus={focusSegment}>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">内容</span>
      <p className="shuihuo-production-source">{segment.sourceText || '未填写原文'}</p>
      <small>{segment.subtitleText || '未设置字幕'}</small>
      <MediaContent kind="audio" items={audioMedia} index={index} onSetPrimary={onSetPrimary} onDeleteMedia={onDeleteMedia} onPreviewMedia={onPreviewMedia} onDownloadMedia={onDownloadMedia} />
      <div className="shuihuo-production-column-actions">
        <Button type="link" size="small" onClick={() => onEdit(segment)}>编辑分段</Button>
        {onMove ? <><Button type="link" size="small" onClick={() => onMove(-1)} disabled={index === 0}>上移</Button><Button type="link" size="small" onClick={() => onMove(1)}>下移</Button></> : null}
        {onDelete ? <Popconfirm title="删除这个分段？绑定的素材关系也会解除。" onConfirm={onDelete}><Button type="link" danger size="small">删除</Button></Popconfirm> : null}
      </div>
    </div>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">角色</span>
      <div className="shuihuo-tag-list">{assets.map(asset => <Tag key={asset.id}>{asset.name}</Tag>)}</div>
      {!assets.length ? <span className="shuihuo-muted">未绑定角色或场景</span> : null}
      <div className="shuihuo-production-column-actions"><Button type="link" size="small" onClick={() => onBindAssets(segment)}>调整资产</Button></div>
    </div>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">图片提示词</span>
      <PromptContent prompt={segment.imagePrompt} locked={segment.imagePromptLocked} onEdit={() => onEdit(segment)} />
    </div>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">图片</span>
      <MediaContent kind="image" items={imageMedia} index={index} onSetPrimary={onSetPrimary} onDeleteMedia={onDeleteMedia} onPreviewMedia={onPreviewMedia} onDownloadMedia={onDownloadMedia} onUpload={kind => onUploadMedia(segment, kind)} />
    </div>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">视频提示词</span>
      <PromptContent prompt={segment.videoPrompt} locked={segment.videoPromptLocked} onEdit={() => onEdit(segment)} />
    </div>
    <div className="shuihuo-production-column">
      <span className="shuihuo-production-column-title">视频</span>
      <MediaContent kind="video" items={videoMedia} index={index} onSetPrimary={onSetPrimary} onDeleteMedia={onDeleteMedia} onPreviewMedia={onPreviewMedia} onDownloadMedia={onDownloadMedia} onUpload={kind => onUploadMedia(segment, kind)} />
    </div>
  </article>;
}
