import { Button, Typography } from 'antd';
import { Link } from '../../shared/components/Link';

const modules = [
  { href: '/admin/accounts', title: '账号与授权', text: '创建账号、审核申请、重置密码和分配后台权限。', action: '管理账号' },
  { href: '/admin/presets', title: '系统预设词', text: '以草稿、发布和回滚方式维护后端系统预设词。', action: '管理预设词' },
  { href: '/admin/agent-skills', title: 'CM 平台技能', text: '维护用户可选择、且仅在服务端调用的创作技能。', action: '管理技能' },
  { href: '/admin/shuihuo-models', title: '水货生产模型', text: '维护可用模型和后端服务端配置。', action: '管理模型' },
  { href: '/admin/error-logs', title: '错误日志', text: '查看前端页面、接口和服务端异常，便于定位问题。', action: '查看日志' }
];

export function DashboardPage() {
  return <section className="admin-dashboard">
    <div className="admin-page-heading"><div><Typography.Title level={2}>管理后台</Typography.Title><Typography.Paragraph>集中管理账号、系统预设词与生产模型。</Typography.Paragraph></div></div>
    <div className="admin-dashboard-grid">{modules.map(module => <section className="admin-surface" key={module.href}><h3>{module.title}</h3><p>{module.text}</p><Link href={module.href}><Button type="primary">{module.action}</Button></Link></section>)}</div>
  </section>;
}
