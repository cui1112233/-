import { Alert, Button, Card, Select, Space, Statistic, Tag, Typography, message } from 'antd';
import { Factory } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { generateBatchFactoryBatch } from '../../../shared/api/batchFactory';
import { loadBatchFactoryVideoModels } from './BatchFactoryProductionControls';

export function BatchFactoryBulkProduction({ batch, onRefresh }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const readyItems = useMemo(() => (batch?.items || []).filter(item => (
    item.status === 'complete'
    && item.directorResult?.storyboard?.length
    && !item.production?.projectId
  )), [batch]);
  const producedItems = useMemo(() => (batch?.items || []).filter(item => item.production?.projectId), [batch]);
  const directModels = useMemo(() => models.filter(model => model.requiresImageInput !== true), [models]);

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    loadBatchFactoryVideoModels()
      .then(videoModels => {
        if (!active) return;
        setModels(videoModels);
        const available = videoModels.filter(model => model.requiresImageInput !== true);
        if (available.length) setModelId(current => current || available[0].id);
      })
      .catch(error => { if (active) message.error(error.message || '读取视频模型失败'); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, []);

  async function generateAll() {
    if (!modelId) return message.warning('请选择文生视频模型');
    if (!readyItems.length) return message.warning('当前没有待提交生产的已完成开篇');
    setSubmitting(true);
    try {
      const result = await generateBatchFactoryBatch(batch.id, modelId);
      await onRefresh?.();
      if (result.failedItems) {
        message.warning(`整批提交完成：${result.succeededItems}/${result.totalItems} 篇成功，${result.queuedVideos}/${result.totalVideos} 个 VIDEO 已排队。`);
      } else {
        message.success(`整批已提交：${result.succeededItems} 篇、${result.queuedVideos} 个 VIDEO 已进入生产队列。`);
      }
    } catch (error) {
      message.error(error.message || '整批提交视频生产失败');
    } finally {
      setSubmitting(false);
    }
  }

  return <Card title={<Space><Factory size={17} /><span>整批视频生产</span></Space>}>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap size="large">
        <Statistic title="待生产开篇" value={readyItems.length} />
        <Statistic title="已创建生产项目" value={producedItems.length} />
        <Tag color="blue">浏览器只提交 1 次请求</Tag>
        <Tag>服务端并发 3</Tag>
      </Space>
      {directModels.length ? <>
        <Typography.Text type="secondary">选择一次模型后，会把所有已完成且尚未生产的开篇逐篇转成正式生产项目；每篇内部的所有 VIDEO 一次入队。已生产的开篇自动跳过。</Typography.Text>
        <Space wrap>
          <Select
            loading={loadingModels}
            value={modelId}
            onChange={setModelId}
            style={{ minWidth: 300 }}
            options={directModels.map(model => ({ value: model.id, label: `${model.name} · 文生视频` }))}
            placeholder="选择整批视频模型"
          />
          <Button type="primary" icon={<Factory size={15} />} loading={submitting} disabled={!readyItems.length} onClick={generateAll}>生成全部已完成开篇</Button>
        </Space>
      </> : <Alert
        type="warning"
        showIcon
        message="暂无文生视频模型"
        description="管理员需要先在「水货生产模型」中配置已启用的 generic_http 视频模型。请求模板不包含 {{image_url}} 才会被识别为文生视频。"
      />}
    </Space>
  </Card>;
}
