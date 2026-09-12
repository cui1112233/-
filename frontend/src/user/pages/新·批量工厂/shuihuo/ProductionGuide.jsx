import { Button, Tag } from 'antd';

export function getProductionSteps(data) {
  const segments = data.segments || [];
  const assets = data.assets || [];
  const bindings = data.segmentAssetIDs || {};
  const media = (data.media || []).map(item => item.media || item);
  const confirmed = data.project?.segmentationStatus === 'confirmed' && segments.length > 0;
  const bound = confirmed && segments.every(segment => (bindings[segment.id] || []).length > 0);
  const imagePrompts = confirmed && segments.every(segment => segment.imagePrompt?.trim());
  const images = confirmed && segments.every(segment => media.some(item => item.segmentId === segment.id && item.kind === 'image'));
  const primaryImages = confirmed && segments.every(segment => media.some(item => item.segmentId === segment.id && item.kind === 'image' && item.isPrimary));
  const videoPrompts = confirmed && segments.every(segment => segment.videoPrompt?.trim());
  const videos = confirmed && segments.every(segment => media.some(item => item.segmentId === segment.id && item.kind === 'video'));
  return [
    { id: 'segments', title: '1. 确认分镜', done: confirmed, description: confirmed ? `已确认 ${segments.length} 个分镜。` : '先用智能分段、快速分段或导入分段生成候选，再人工确认。', action: '进入分镜设置' },
    { id: 'assets', title: '2. 分析并采纳资产', done: assets.length > 0, description: assets.length ? `已有 ${assets.length} 项人物、场景或道具。` : '分析原文候选，检查后采纳为项目资产。', action: '打开资产候选' },
    { id: 'bindings', title: '3. 绑定分镜资产', done: bound, description: bound ? '每个分镜均已绑定资产。' : '进入高级编辑，在每个分镜的角色列绑定人物、场景或道具。', action: '进入高级编辑' },
    { id: 'images', title: '4. 图片提示词与生图', done: imagePrompts && images, description: !imagePrompts ? '先批量生成并应用图片提示词。' : !images ? '提示词已准备，进入高级编辑提交图片生成任务。' : '每个分镜均已有图片。', action: '进入高级编辑' },
    { id: 'videos', title: '5. 视频提示词与图生视频', done: videoPrompts && videos, description: !primaryImages ? '请先在每个分镜图片列选择一张主图。' : !videoPrompts ? '主图已齐，接着生成视频提示词。' : !videos ? '提示词已准备，进入高级编辑提交视频任务。' : '每个分镜均已有视频。', action: '进入高级编辑' },
    { id: 'export', title: '6. 导出成片', done: false, description: videos ? '视频已就绪；ZIP、合并视频和剪映草稿导出将随后开放。' : '完成所有分镜视频后开放。', action: '' }
  ];
}

export function ProductionGuide({ data, onOpenAssets, onOpenStudio }) {
  const steps = getProductionSteps(data);
  return <section className="shuihuo-view">
    <div className="shuihuo-page-heading"><div><h2>生产向导</h2><p>按顺序完成即可。每一项只在前置条件满足后再进入下一步；需要精细调整时使用高级编辑。</p></div><Button onClick={onOpenStudio}>进入高级编辑</Button></div>
    <div className="shuihuo-guide-list">{steps.map(step => <article className={`shuihuo-guide-step ${step.done ? 'done' : ''}`} key={step.id}><div><Tag color={step.done ? 'success' : 'default'}>{step.done ? '已完成' : '待处理'}</Tag><h3>{step.title}</h3><p>{step.description}</p></div>{step.action ? <Button type={step.done ? 'default' : 'primary'} onClick={step.id === 'assets' ? onOpenAssets : onOpenStudio}>{step.action}</Button> : null}</article>)}</div>
  </section>;
}
