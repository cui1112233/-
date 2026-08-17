import { Alert, Button, Modal, Select, Upload, message } from 'antd';
import { useEffect, useState } from 'react';

const choices = [{ value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'audio', label: '音频' }];

function fileToDataURL(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取文件失败')); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
}

export function MediaModal({ open, projectId, segments, saving, onCancel, onUpload, initialKind = 'image', initialSegmentId }) {
  const [kind, setKind] = useState(initialKind);
  const [file, setFile] = useState(null);
  const [segmentId, setSegmentId] = useState(initialSegmentId);

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setSegmentId(initialSegmentId);
    }
  }, [open, initialKind, initialSegmentId]);
  async function submit() {
    if (!file) { message.warning('请选择文件'); return; }
    try { await onUpload({ kind, filename: file.name, dataUrl: await fileToDataURL(file), segmentId }); setFile(null); setSegmentId(undefined); } catch (error) { message.error(error.message || '上传素材失败'); }
  }
  return <Modal title="上传素材" open={open} onCancel={onCancel} onOk={submit} okText="上传并保存" confirmLoading={saving}>
    <Alert type="info" showIcon message="支持人工上传" description="上传后可绑定已确认分段、设为主素材或删除。生成模型尚未配置时，不能用上传冒充生成结果。" />
    <label className="shuihuo-form-label">素材类型</label><Select value={kind} onChange={setKind} options={choices} />
    <label className="shuihuo-form-label">绑定分段</label><Select allowClear placeholder="暂不绑定" value={segmentId} onChange={setSegmentId} options={segments.map(item => ({ value: item.id, label: `#${item.orderIndex} ${item.sourceText.slice(0, 22)}` }))} />
    <label className="shuihuo-form-label">文件</label><Upload beforeUpload={selected => { setFile(selected); return false; }} maxCount={1} onRemove={() => setFile(null)} accept={kind === 'image' ? 'image/png,image/jpeg,image/webp' : kind === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4'}><Button>选择文件</Button></Upload>
  </Modal>;
}
