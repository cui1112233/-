import { Alert, Space, Tag, Typography } from 'antd';
import { changeImpactView } from './changeImpactView.js';

function countTags(impact) {
  const tags = [];
  if (impact.affectedBooks !== null) tags.push(<Tag key="books">影响小说 {impact.affectedBooks}</Tag>);
  if (impact.affectedVideos !== null) tags.push(<Tag key="videos">影响视频 {impact.affectedVideos}</Tag>);
  if (impact.orphanedOverrides !== null) tags.push(<Tag key="orphaned" color={impact.orphanedOverrides > 0 ? 'gold' : undefined}>孤立覆盖 {impact.orphanedOverrides}</Tag>);
  if (impact.incompatibleOverrides !== null) tags.push(<Tag key="incompatible" color={impact.incompatibleOverrides > 0 ? 'red' : undefined}>不兼容覆盖 {impact.incompatibleOverrides}</Tag>);
  return tags;
}

export function ChangeImpactNotice({ result = null, loading = false }) {
  if (loading) {
    return <Alert
      type="info"
      showIcon
      message="正在读取变更影响"
      description="影响范围由批量工厂服务端计算。"
    />;
  }

  if (!result) return null;

  if (result.ok !== true) {
    return <Alert
      type="warning"
      showIcon
      message="无法读取影响"
      description={result.message || '影响范围暂时不可用；前端不会生成本地替代结果。'}
    />;
  }

  const impact = changeImpactView(result.impact);
  const tags = countTags(impact);
  const serverText = impact.warning || impact.reason;
  const hasExplicitResult = tags.length > 0 || impact.invalidatesDirector !== null || Boolean(serverText);

  return <Alert
    type={impact.invalidatesDirector === true || (impact.orphanedOverrides ?? 0) > 0 || (impact.incompatibleOverrides ?? 0) > 0 ? 'warning' : 'info'}
    showIcon
    message={serverText || (hasExplicitResult ? 'Go 已返回变更影响' : 'Go 未返回显式影响范围')}
    description={<Space direction="vertical" size={6}>
      {tags.length ? <Space wrap>{tags}</Space> : null}
      {impact.invalidatesDirector === true ? <Tag color="orange">保存后编排记录失效</Tag> : null}
      {impact.invalidatesDirector === false ? <Tag color="green">编排记录保持有效</Tag> : null}
      {!hasExplicitResult ? <Typography.Text type="secondary">没有显式数字或状态时不做本地推断。</Typography.Text> : null}
    </Space>}
  />;
}

export default ChangeImpactNotice;
