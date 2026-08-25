import { Alert, Button, Card, Select, Space, Statistic, Tag, Typography, message } from 'antd';
import { Factory } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { generateBatchFactoryBatch } from '../../../shared/api/batchFactory';
import { loadBatchFactoryVideoModels } from './BatchFactoryProductionControls';
import { BatchFactoryBatchProductionStatus } from './BatchFactoryVideoProductionStatus';

function compatibleLegacyModels(models, batch) {
  const requiredDuration = Number(batch?.settings?.maxVideoDuration || 0);
  return models.filter(model => (
    model.requiresImageInput !== true
    && Number.isInteger(Number(model.maxVideoDuration))
    && Number(model.maxVideoDuration) >= 1
    && (!requiredDuration || Number(model.maxVideoDuration) >= requiredDuration)
  ));
}

export function BatchFactoryBulkProduction({ batch, onRefresh }) {
  const [models, setModels] = useState([]);
  const [legacyModelId, setLegacyModelId] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const boundModelId = Number(batch?.settings?.videoModelId || 0) || null;
  const modelId = boundModelId || legacyModelId;

  const readyItems = useMemo(() => (batch?.items || []).filter(item => (
    item.status === 'complete'
    && item.directorResult?.storyboard?.length
    && !item.production?.projectId
  )), [batch]);
  const producedItems = useMemo(() => (batch?.items || []).filter(item => item.production?.projectId), [batch]);
  const legacyModels = useMemo(() => compatibleLegacyModels(models, batch), [models, batch]);
  const boundModel = useMemo(() => models.find(model => Number(model.id) === boundModelId) || null, [models, boundModelId]);

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    loadBatchFactoryVideoModels()
      .then(videoModels => {
        if (!active) return;
        setModels(videoModels);
        if (!boundModelId) {
          const compatible = compatibleLegacyModels(videoModels, batch);
          if (compatible.length) setLegacyModelId(current => current || compatible[0].id);
        }
      })
      .catch(error => { if (active) message.error(error.message || '读取视频模型失败'); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [boundModelId, batch?.settings?.maxVideoDuration]);

  async function generateAll() {
    if (!modelId) return message.warning('当前批次没有可用的视频模型');
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

  const boundUnavailable = boundModelId && !loadingModels && !boundModel;

  return <Space direction="vertical" size={14} style={{ width: '100%' }}>
    <Card title={<Space><Factory size={17} /><span>整批视频生产</span></Space>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap size="large">
          <Statistic title="待生产开篇" value={readyItems.length} />
          <Statistic title="已创建生产项目" value={producedItems.length} />
          <Tag color="blue">浏览器只提交 1 次请求</Tag>
          <Tag>服务端并发 3</Tag>
        </Space>

        {boundModelId ? <>
          <Typography.Text type="secondary">整批生产直接沿用导演前锁定的视频模型。所有已完成且尚未生产的小说逐篇创建正式生产项目，每篇内部的全部 VIDEO 一次入队。</Typography.Text>
          <Space wrap>
            <Tag color="blue">{batch.settings?.videoModelName || boundModel?.name || `模型 #${boundModelId}`}</Tag>
            <Tag>单次最大 {batch.settings?.maxVideoDuration || '—'}s</Tag>
            <Tag>{batch.settings?.aspectRatio || '9:16'}</Tag>
          </Space>
          {boundUnavailable ? <Alert type="warning" showIcon message="已绑定模型当前不可用" description="模型可能已停用或不再公开。请恢复原模型后再生产；不能在这里换成另一模型，因为导演方案已经按原模型时长能力生成。" /> : null}
          <Button type="primary" icon={<Factory size={15} />} loading={submitting} disabled={!readyItems.length || boundUnavailable || !modelId} onClick={generateAll} style={{ alignSelf: 'flex-start' }}>生成全部已完成开篇</Button>
        </> : legacyModels.length ? <>
          <Alert type="info" showIcon message="历史批次兼容模式" description={`这个批次创建时没有绑定视频模型，只允许选择单次最大时长不小于导演上限 ${batch?.settings?.maxVideoDuration || '—'}s 的文生视频模型。`} />
          <Space wrap>
            <Select
              loading={loadingModels}
              value={legacyModelId}
              onChange={setLegacyModelId}
              style={{ minWidth: 320 }}
              options={legacyModels.map(model => ({ value: model.id, label: `${model.name} · 最大 ${model.maxVideoDuration}s` }))}
              placeholder="选择兼容视频模型"
            />
            <Button type="primary" icon={<Factory size={15} />} loading={submitting} disabled={!readyItems.length} onClick={generateAll}>生成全部已完成开篇</Button>
          </Space>
        </> : <Alert
          type="warning"
          showIcon
          message="暂无兼容的文生视频模型"
          description="管理员需要先配置已启用的文生视频模型及单次最大生成时长。新批次会在导演前直接锁定模型。"
        />}
      </Space>
    </Card>
    <BatchFactoryBatchProductionStatus batch={batch} />
  </Space>;
}
