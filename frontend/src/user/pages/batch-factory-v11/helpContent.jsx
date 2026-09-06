import { Button, Tooltip, Typography } from 'antd';

export const BATCH_FACTORY_HELP = {
  header: ['批量工厂用于把多本小说分别走一遍“编剧 → 视频生成 → 合并 → 发布”。所有正文窗口和提示词以服务端返回为准。', '每次新增功能都会在这里补充使用说明。'],
  bookList: ['小说列表显示书名、性别、小说 ID、类型、来源和状态。勾选后可只对选中小说执行编剧、生成视频或发布；不勾选时执行全部。'],
  source: ['原文只展示当前内容幅度。系统默认 5 行，可在生产统一设置或当前小说设置中调整；AI 分析也只使用同一窗口。'],
  writing: ['开启编剧会使用后台保存的剧本、人物场景道具和视频提示词，生成可审核的编排结果。单本操作和批量操作调用同一服务。'],
  video: ['开启导演会按生产统一设置提交视频任务。先完成编剧，再在视频生成区提交任务；状态会自动轮询写回。'],
  publish: ['开启发布前需确认账号、登录状态和发布回执。视频上传接口未验证时，发布按钮保持不可用，不会伪报成功。'],
  settings: ['生产统一设置保存批次级默认值；当前小说设置只保存单本覆盖。没有覆盖的字段继续继承上层设置。']
};

export function HelpButton({ topic = 'header', label = '查看使用说明' }) {
  const paragraphs = BATCH_FACTORY_HELP[topic] || BATCH_FACTORY_HELP.header;
  return <Tooltip title={<div style={{ maxWidth: 340 }}>{paragraphs.map((text, index) => <Typography.Paragraph key={index} style={{ color: 'inherit', marginBottom: index === paragraphs.length - 1 ? 0 : 8 }}>{text}</Typography.Paragraph>)}</div>}>
    <Button type="text" size="small" shape="circle" aria-label={label} title={label}>?</Button>
  </Tooltip>;
}

