import { Alert, Button, Card, Select, Space, Tag, Typography, message } from 'antd';
import { Clapperboard, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { generateBatchFactoryVideos } from '../../../shared/api/batchFactory';
import { listModels } from '../../../shared/api/shuihuoProduction';

let modelCatalogPromise = null;

export function loadBatchFactoryVideoModels() {
  if (!modelCatalogPromise) {
    modelCatalogPromise = listModels()
      .then(result => (result.models || []).filter(model => model.kind === 'video'))
      .catch(error => {
        modelCatalogPromise = null;
        throw error;
      });
  }
  return modelCatalogPromise;
}

export function BatchFactoryProductionControls({ batch, item, onRefresh }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingModels(true);
    loadBatchFactoryVideoModels()
      .then(videoModels => {
        if (!active) return;
        setModels(videoModels);
        const directModels = videoModels.filter(model => model.requiresImageInput !== true);
        if (directModels.length) setModelId(current => current || directModels[0].id);
      })
      .catch(error => { if (active) message.error(error.message || '读取视频模型失败'); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, []);

  const directModels = useMemo(() => models.filter(model => model.requiresImageInput !== true), [models]);
  const imageModels = useMemo(() => models.filter(model => model.requiresImageInput === true), [models]);
  const production = item?.production;

  async function generate() {
    if (!modelId) return message.warning('请选择文生视频模型');
    setSubmitting(true);
    try {
      const result = await generateBatchFactoryVideos(batch.id, item.id, modelId);
      await onRefresh?.();
      const queued = result.production?.queued ?? 0;
      const total = result.production?.total ?? 0;
      if (result.production?.failed) message.warning(`已提交生产：${queued}/${total} 个 VIDEO 进入队列，部分任务需要检查。`);
      else message.success(`已提交生产：${queued}/${total} 个 VIDEO 已进入视频队列。`);
    } catch (error) {
      message.error(error.message || '提交视频生产失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (production?.projectId) {
    return <Card size="small" title="视频生产" style={{ width: '100%' }}>
      <Space wrap>
        <Tag color={production.status === 'partial' ? 'gold' : 'processing'}>生产项目 #{production.projectId}</Tag>
        <Tag>{production.modelName || `模型 #${production.modelId}`}</Tag>
        <Typography.Text>{production.queued}/{production.total} 个 VIDEO 已排队</Typography.Text>
        {production.failed ? <Tag color="red">{production.failed} 个提交失败</Tag> : null}
        <Button icon={<ExternalLink size={14} />} onClick={() => { window.location.href = '/shuihuo-production'; }}>打开视频生产</Button>
      </Space>
    </Card>;
  }

  return <Card size="small" title="生成视频" style={{ width: '100%' }}>
    {directModels.length ? <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Typography.Text type="secondary">这里会一次编译本篇全部 VIDEO，并由服务端一次性创建正式生产项目和 Redis 视频任务。未点击前不会污染生产项目列表。</Typography.Text>
      <Space wrap>
        <Select
          loading={loadingModels}
          value={modelId}
          onChange={setModelId}
          style={{ minWidth: 280 }}
          options={directModels.map(model => ({ value: model.id, label: `${model.name} · 文生视频` }))}
          placeholder="选择文生视频模型"
        />
        <Button type="primary" icon={<Clapperboard size={15} />} loading={submitting} onClick={generate}>生成全部 VIDEO</Button>
      </Space>
      {imageModels.length ? <Typography.Text type="secondary">另有 {imageModels.length} 个图生视频模型未显示；它们需要先在正式生产项目中绑定主图片。</Typography.Text> : null}
    </Space> : <Alert
      type="warning"
      showIcon
      message="暂无可直接生成的文生视频模型"
      description="请管理员在「水货生产模型」新增或启用 generic_http 视频模型，并确保请求模板不包含 {{image_url}}。Vidu 等图生视频模型不能从这里无图直出。"
    />}
  </Card>;
}
