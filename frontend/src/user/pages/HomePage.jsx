import { Button } from 'antd';
import { Link } from '../../shared/components/Link';

const quickActions = [
  {
    href: '/script',
    className: 'card-write',
    icon: '📝',
    title: '新建剧本项目',
    desc: '一键导入小说，自动拆分智能分镜'
  },
  {
    href: '/agent',
    className: 'card-agent',
    icon: '🤖',
    title: 'AI 智能 Agent',
    desc: '专属助手对话，辅助精细化剧本包装'
  },
  {
    href: '/tts',
    className: 'card-tts',
    icon: '🎙',
    title: '声音配音工坊',
    desc: '多音色情感合成，让你的画面声临其境'
  }
];

const navItems = [
  { href: '/', label: '首页' },
  { href: '/script', label: '剧本生成' },
  { href: '/history', label: '历史' },
  { href: '/tts', label: '配音' },
  { href: '/settings', label: '设置' }
];

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-video-hero">
        <video
          className="home-hero-video"
          autoPlay
          muted
          loop
          playsInline
          poster="/assets/logo.jpg"
        >
          <source src="/assets/home-hero.mp4" type="video/mp4" />
        </video>
        <div className="home-video-overlay" />

        <nav className="home-hero-nav">
          <Link href="/" className="home-hero-brand">
            <img src="/assets/logo-transparent.png" alt="一战晟铭 logo" />
            <span>一战晟铭</span>
          </Link>
          <div className="home-hero-links">
            {navItems.map(item => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
          </div>
          <a className="contact-button" href="#contact">联系</a>
        </nav>

        <div className="home-hero-content">
          <p className="home-hero-kicker">Novel Visual Script Studio</p>
          <h1 className="home-hero-title">让小说章节直接进入可视化剧本工作流</h1>
          <p className="home-hero-subtitle">从原文提取人物、场景、节奏和镜头结构，生成可继续编辑、导出和配音的短剧制作素材。</p>
          <div className="home-hero-actions">
            <Button type="primary" size="large" href="/script">开始生成</Button>
            <Button size="large" href="/tts">进入配音</Button>
          </div>
        </div>
      </section>

      <section className="home-quick-actions">
        {quickActions.map(action => (
          <Link key={action.href} href={action.href} className={`quick-action-card ${action.className}`}>
            <span className="card-icon">{action.icon}</span>
            <span className="card-info">
              <span className="card-title">{action.title}</span>
              <span className="card-desc">{action.desc}</span>
            </span>
            <span className="card-arrow">➔</span>
          </Link>
        ))}
      </section>

      <section className="home-recent-section">
        <div className="section-header">
          <h2 className="section-title">📂 最近创作项目</h2>
          <Button href="/history">查看全部历史记录</Button>
        </div>
        <div className="recent-grid">
          <div className="recent-empty">
            <div className="empty-icon">📂</div>
            <p>暂无最近的创作记录，点击上方“开始生成”进入首个剧本项目。</p>
          </div>
        </div>
      </section>

      <section id="contact" className="home-contact-section">
        <div>
          <h2>需要配置账号或部署环境？</h2>
          <p>联系管理员获取登录账号、API 配置和本地部署支持。</p>
        </div>
        <Button href="/settings">打开设置</Button>
      </section>
    </div>
  );
}
