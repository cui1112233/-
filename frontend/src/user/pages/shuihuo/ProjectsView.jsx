import { useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';

export function filterProjects(projects, query, status = 'all', sortBy = 'updated') {
  const normalized = query.trim().toLocaleLowerCase();
  const list = projects.filter(project => {
    const matchesName = !normalized || project.name?.toLocaleLowerCase().includes(normalized);
    const matchesStatus = status === 'all' || project.segmentationStatus === status;
    return matchesName && matchesStatus;
  });
  return list.sort((left, right) => {
    if (sortBy === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    const leftTime = Date.parse(sortBy === 'created' ? left.createdAt : left.updatedAt) || 0;
    const rightTime = Date.parse(sortBy === 'created' ? right.createdAt : right.updatedAt) || 0;
    return rightTime - leftTime;
  });
}

export function ProjectsView({ projects, onCreate, onOpen, onDelete, onFiles }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const list = useMemo(() => filterProjects(projects, query, status, sortBy), [projects, query, status, sortBy]);

  return <section className="shuihuo-view">
    <div className="shuihuo-page-heading">
      <div><h2>漫剧解说</h2><p>管理和创建您的漫剧解说作品。</p></div>
      <Button type="primary" onClick={onCreate}>创建漫剧</Button>
    </div>
    <div className="shuihuo-toolbar shuihuo-project-toolbar">
      <Input.Search value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索作品名称" allowClear />
      <Select value={status} onChange={setStatus} options={[
        { value: 'all', label: '全部状态' },
        { value: 'draft', label: '草稿' },
        { value: 'confirmed', label: '已确认分段' }
      ]} />
      <Select value={sortBy} onChange={setSortBy} options={[
        { value: 'updated', label: '最近更新' },
        { value: 'created', label: '创建时间' },
        { value: 'name', label: '名称排序' }
      ]} />
    </div>
    <div className="shuihuo-project-grid">
      {list.map(project => <article className="shuihuo-project-card" key={project.id}>
        <button className="shuihuo-project-card-open" type="button" onClick={() => onOpen(project)}>
          <div className="shuihuo-project-thumb">{project.segmentationStatus === 'confirmed' ? '已确认分段' : '等待人工分段确认'}</div>
          <strong>{project.name}</strong>
          <span>{project.segmentationStatus === 'confirmed' ? '可继续制作' : '仅已保存原文'}</span>
          <small>{project.updatedAt ? new Date(project.updatedAt).toLocaleString() : ''}</small>
        </button>
        <div className="shuihuo-project-card-actions">
          <Button type="link" size="small" onClick={() => onFiles(project)}>查看文件</Button>
          <Popconfirm title="删除项目？" description="分段、资产、任务和素材记录都会删除，无法恢复。" okText="确认删除" cancelText="取消" onConfirm={() => onDelete(project)}>
            <Button type="text" danger size="small">删除</Button>
          </Popconfirm>
        </div>
      </article>)}
      {!list.length ? <div className="shuihuo-empty"><b>◎</b><p>还没有漫剧作品</p><Button type="primary" onClick={onCreate}>创建漫剧</Button></div> : null}
    </div>
  </section>;
}
