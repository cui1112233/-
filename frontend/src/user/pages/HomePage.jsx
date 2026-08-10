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

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero-banner">
        <div className="banner-glow-bg" />
        <img className="hero-logo" src="/assets/logo-transparent.png" alt="一战晟铭 logo" />
        <h1 className="banner-title">一战晟铭</h1>
        <p className="banner-subtitle">探索文字的视觉边界，将小说章节转化为可视化剧本</p>
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
            <p>暂无最近的创作记录，点击上方“新建剧本项目”开始首个剧本吧！</p>
          </div>
        </div>
      </section>
    </div>
  );
}
