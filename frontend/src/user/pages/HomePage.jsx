import { Button } from 'antd';
import { AudioLines, Bot, ChevronRight, Clapperboard, FilePenLine, FolderClock, LayoutPanelTop } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandLogo } from '../../shared/components/BrandLogo';
import { GradientButton } from '../../shared/components/GradientButton';
import { listPlatformProjects } from '../../shared/api/platformProjects';
import { Link } from '../../shared/components/Link';
import HomeSplashCursor from '../components/HomeSplashCursor';

const quickActions = [
  { href: '/script', className: 'card-write', icon: FilePenLine, title: '新建剧本项目', desc: '导入小说，生成可编辑剧本与制作素材' },
  { href: '/novel-panel', className: 'card-panel', icon: LayoutPanelTop, title: '小说面板', desc: '分析人物、场景与分镜，保存完整项目' },
  { href: '/shuihuo-production', className: 'card-shuihuo', icon: Clapperboard, title: '水货生产', desc: '分段、提示词、素材和视频任务生产' },
  { href: '/agent', className: 'card-agent', icon: Bot, title: 'AI 智能 Agent', desc: '专属助手对话，辅助精细化剧本包装' },
  { href: '/tts', className: 'card-tts', icon: AudioLines, title: '声音配音工坊', desc: '多音色情感合成，让你的画面声临其境' }
];

const navItems = [
  { href: '/', label: '首页' },
  { href: '/script', label: '剧本生成' },
  { href: '/novel-panel', label: '小说面板' },
  { href: '/shuihuo-production', label: '水货生产' },
  { href: '/agent', label: 'Agent 工作区' },
  { href: '/history', label: '历史' },
  { href: '/tts', label: '配音' },
  { href: '/settings', label: '设置' }
];

const projectIcons = {
  'script-history': FilePenLine,
  'novel-panel': LayoutPanelTop,
  'shuihuo-production': Clapperboard
};

function formatTime(value) {
  if (!value) return '刚刚保存';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '刚刚保存' : date.toLocaleString('zh-CN', { hour12: false });
}

export function HomePage({ isLoggedIn, onOpenLogin }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setProjects([]);
      return;
    }
    let active = true;
    setLoadingProjects(true);
    // A stale remembered session is cleared by apiRequest; the login panel is
    // the appropriate recovery UI, rather than an error modal for this
    // optional homepage preview.
    listPlatformProjects(6, { silent: true })
      .then(data => { if (active) setProjects(Array.isArray(data.entries) ? data.entries : []); })
      .catch(() => { if (active) setProjects([]); })
      .finally(() => { if (active) setLoadingProjects(false); });
    return () => { active = false; };
  }, [isLoggedIn]);

  function requireLogin(event) {
    if (isLoggedIn) return;
    event.preventDefault();
    onOpenLogin?.();
  }

  function openProtectedPage(href) {
    if (!isLoggedIn) {
      onOpenLogin?.();
      return;
    }
    window.location.href = href;
  }

  return (
    <div className="home-page">
      <section className="home-video-hero">
        <video className="home-hero-video" autoPlay muted loop playsInline>
          <source src="/assets/home-hero.mp4" type="video/mp4" />
        </video>
        <div className="home-video-overlay" />
        <HomeSplashCursor />

        <nav className="home-hero-nav">
          <Link href="/" className="home-hero-brand"><BrandLogo className="home-brand-logo" /><span>一战晟铭</span></Link>
          <div className="home-hero-links">
            {navItems.map(item => <Link key={item.href} href={item.href} onClick={item.href === '/' ? undefined : requireLogin}>{item.label}</Link>)}
          </div>
          <div className="home-hero-actions-right">
            <GradientButton as="a" href="#contact">联系</GradientButton>
          </div>
        </nav>

        <div className="home-hero-content">
          <p className="home-hero-kicker">Novel Visual Script Studio</p>
          <h1 className="home-hero-title">让小说章节直接进入可视化剧本工作流</h1>
          <p className="home-hero-subtitle">从原文提取人物、场景、节奏和镜头结构，生成可继续编辑、导出和配音的短剧制作素材。</p>
          <div className="home-hero-actions">
            <GradientButton onClick={() => openProtectedPage('/script')}>开始生成</GradientButton>
            <GradientButton onClick={() => openProtectedPage('/tts')}>进入配音</GradientButton>
          </div>
        </div>
      </section>

      <section className="home-quick-actions">
        {quickActions.map(action => {
          const Icon = action.icon;
          return <Link key={action.href} href={action.href} onClick={requireLogin} className={`quick-action-card ${action.className}`}>
            <span className="card-icon"><Icon size={30} strokeWidth={1.7} aria-hidden="true" /></span>
            <span className="card-info"><span className="card-title">{action.title}</span><span className="card-desc">{action.desc}</span></span>
            <ChevronRight className="card-arrow" size={20} aria-hidden="true" />
          </Link>;
        })}
      </section>

      <section className="home-recent-section">
        <div className="section-header"><h2 className="section-title"><FolderClock size={19} aria-hidden="true" />最近创作项目</h2><Button onClick={() => openProtectedPage('/history')}>查看全部历史记录</Button></div>
        <div className="recent-grid">
          {projects.map(project => {
            const Icon = projectIcons[project.kind] || FilePenLine;
            return <Link key={project.id} href={`/history?entry=${encodeURIComponent(project.id)}`} onClick={requireLogin} className="recent-project-card">
              <span className="recent-project-icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="recent-project-body"><span className="recent-project-type">{project.typeLabel}</span><strong>{project.name}</strong><span>{project.summary || '已保存项目'}</span><time>{formatTime(project.updatedAt)}</time></span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>;
          })}
          {!projects.length ? <div className="recent-empty"><FolderClock className="empty-icon" size={40} aria-hidden="true" /><p>{loadingProjects ? '正在读取最近项目…' : '暂无最近的创作记录，创建或保存项目后会显示在这里。'}</p></div> : null}
        </div>
      </section>

      <section id="contact" className="home-contact-section"><div><h2>需要配置账号或部署环境？</h2><p>联系管理员获取登录账号、API 配置和本地部署支持。</p></div><Button onClick={() => openProtectedPage('/settings')}>打开设置</Button></section>
    </div>
  );
}
