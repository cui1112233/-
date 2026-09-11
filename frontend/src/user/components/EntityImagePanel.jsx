import { Button, Image, Spin, Typography } from 'antd';
import { ImagePlus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { generateReferenceAsset, loadReferenceAssetImage, uploadReferenceAsset } from '../../shared/api/novelPanel';
import { appendEntityImage, normalizeEntityImages, removeEntityImage, selectEntityImage } from '../pages/scriptEntityImages';

function apiAssetType(assetType) {
  return assetType === 'characters' ? 'character' : 'scene';
}

function responseUrl(response) {
  return response?.url || response?.data?.url || response?.result?.url || '';
}

export default function EntityImagePanel({ assetType, assetId, fields, novelText, images, onChange, disabled = false }) {
  const [draft, setDraft] = useState(() => normalizeEntityImages(images));
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewUrls, setPreviewUrls] = useState({});
  const inputRef = useRef(null);
  const normalizedAssetType = apiAssetType(assetType);

  useEffect(() => {
    setDraft(normalizeEntityImages(images));
  }, [images]);

  useEffect(() => {
    let active = true;
    const objectUrls = [];
    const imageUrls = draft.imageUrls;

    Promise.all(imageUrls.map(async url => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return [url, url];
      const blob = await loadReferenceAssetImage(url);
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      return [url, objectUrl];
    })).then(entries => {
      if (active) setPreviewUrls(Object.fromEntries(entries));
    }).catch(() => {
      if (active) setPreviewUrls({});
    });

    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [draft.imageUrls.join('\u0000')]);

  function updateDraft(next) {
    const normalized = normalizeEntityImages(next);
    setDraft(normalized);
    onChange?.(normalized);
  }

  function selectImage(url) {
    updateDraft(selectEntityImage(draft, url));
  }

  function deleteImage(event, url) {
    event.stopPropagation();
    updateDraft(removeEntityImage(draft, url));
  }

  async function uploadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;

    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('图片读取失败')));
        reader.readAsDataURL(file);
      });
      const response = await uploadReferenceAsset({
        asset_type: normalizedAssetType,
        asset_id: assetId,
        variant: 'source',
        data_url: dataUrl
      });
      const url = responseUrl(response);
      if (!url) throw new Error('上传未返回图片地址');
      updateDraft(appendEntityImage(draft, url));
    } finally {
      setUploading(false);
    }
  }

  async function generateImage() {
    if (disabled) return;
    setGenerating(true);
    try {
      const response = await generateReferenceAsset({
        asset_type: normalizedAssetType,
        asset_id: assetId,
        description: Object.values(fields || {}).join('\n'),
        novel_text: novelText
      });
      const url = responseUrl(response);
      if (!url) throw new Error('生成未返回图片地址');
      updateDraft(appendEntityImage(draft, url));
    } finally {
      setGenerating(false);
    }
  }

  const busy = uploading || generating;
  const mainPreviewUrl = previewUrls[draft.mainImageUrl];

  return (
    <div className="entity-editor-image-panel">
      <div className="entity-editor-image-panel-heading">
        <Typography.Text strong>主图预览</Typography.Text>
        {busy ? <Spin size="small" /> : null}
      </div>
      {draft.mainImageUrl && mainPreviewUrl ? (
        <div className="entity-editor-main-image">
          <Image src={mainPreviewUrl} alt="主图预览" preview={{ mask: '点击放大' }} />
        </div>
      ) : draft.mainImageUrl ? (
        <div className="entity-editor-image-empty" aria-label="主图加载中">
          <Spin />
          <span>主图加载中</span>
        </div>
      ) : (
        <div className="entity-editor-image-empty" aria-label="暂无主图">
          <ImagePlus size={34} aria-hidden="true" />
          <span>暂无主图</span>
        </div>
      )}

      <div className="entity-editor-image-actions">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadFile} disabled={disabled || busy} hidden />
        <Button icon={<Upload size={15} />} onClick={() => inputRef.current?.click()} disabled={disabled || busy}>上传图片</Button>
        <Button type="primary" icon={<Sparkles size={15} />} onClick={generateImage} loading={generating} disabled={disabled || busy}>AI生成</Button>
      </div>

      <div className="entity-editor-image-grid" aria-label="图片缩略图">
        {draft.imageUrls.map(url => (
          <div className={`entity-editor-image-thumbnail${url === draft.mainImageUrl ? ' is-main' : ''}`} key={url}>
            <button
              className="entity-editor-image-select"
              type="button"
              onClick={() => selectImage(url)}
              disabled={disabled || busy}
              aria-label={`选择图片 ${url}`}
            >
              {previewUrls[url] ? <img src={previewUrls[url]} alt="实体图片缩略图" /> : <Spin size="small" />}
            </button>
            <button
              className="entity-editor-image-delete-control"
              type="button"
              disabled={disabled || busy}
              aria-label="删除图片"
              onClick={event => deleteImage(event, url)}
            ><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
