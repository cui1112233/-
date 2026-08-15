import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { downloadMedia, listProjectFiles } from '../../../shared/api/shuihuoProduction';

function extensionFor(media) {
  if (media.kind === 'image') return 'png';
  if (media.kind === 'video') return 'mp4';
  if (media.kind === 'audio') return 'mp3';
  return 'bin';
}

export function ProjectFilesModal({ open, project, onClose }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    if (!open || !project?.id) return undefined;
    let active = true;
    setFiles(null);
    setError('');
    listProjectFiles(project.id).then(result => {
      if (active) setFiles(result);
    }).catch(requestError => {
      if (active) setError(requestError.message || '读取项目文件失败');
    });
    return () => { active = false; };
  }, [open, project?.id]);

  async function download(media) {
    setDownloading(media.id);
    try {
      const blob = await downloadMedia(media.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}-${media.kind}-${media.id}.${extensionFor(media)}`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  return <Modal title={`${project?.name || ''} · 文件`} open={open} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} width={720}>
    {!files && !error ? <div className="shuihuo-loading"><Spin /></div> : null}
    {error ? <Alert type="error" showIcon message="读取文件失败" description={error} /> : null}
    {files ? <div className="shuihuo-project-files">
      <p>原文文件：{files.hasSourceFile ? '已上传' : '未上传（当前项目使用粘贴原文）'}</p>
      {!files.media?.length ? <p className="shuihuo-muted">暂无已上传的图片、视频或音频素材。</p> : null}
      {(files.media || []).map(media => <div className="shuihuo-project-file" key={media.id}>
        <span>{media.kind === 'image' ? '图片' : media.kind === 'video' ? '视频' : '音频'} #{media.id}{media.segmentId ? ` · 分镜 ${media.segmentId}` : ''}</span>
        <Button type="link" size="small" loading={downloading === media.id} onClick={() => download(media)}>下载</Button>
      </div>)}
    </div> : null}
  </Modal>;
}
