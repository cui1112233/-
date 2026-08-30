import { Button, Typography } from 'antd';
import { Link } from '../../shared/components/Link';

const modules = [
  { href: '/admin/presets', title: '提示词库', text: '集中保存剧本、小说和水货生产的系统提示词，以草稿、发布和回滚方式维护。', action: '管理提示词' },
  { href: '/admin/prompts', title: 'Prompt 策略', text: '查看各创作模式的提示词策略和输出格式归属。', action: '查看策略' },
  { href: '/admin/agent-skills', title: 'CM 平台技能', text: '维护用户可选择、且仅在服务端调用的创作技能。', action: '管理技能' },
  { href: '/admin/shuihuo-models', title: '水货生产模型', text: '维护可用模型和后端服务端配置。', action: '管理模型' },
  { href: '/admin/error-logs', title: '错误日志', text: '查看前端页面、接口和服务端异常，便于定位问题。', action: '查看日志' }
];

export function DashboardPage() {
  return <section className="admin-dashboard">
    <div className="admin-page-heading"><div><Typography.Title level={2}>管理后台</Typography.Title><Typography.Paragraph>开发者专用的提示词与平台运行工具。账号、管理员和组员授权请在个人中心完成。</Typography.Paragraph></div></div>
    <div className="admin-dashboard-grid">{modules.map(module => <section className="admin-surface" key={module.href}><h3>{module.title}</h3><p>{module.text}</p><Link href={module.href}><Button type="primary">{module.action}</Button></Link></section>)}</div>
  </section>;
}
