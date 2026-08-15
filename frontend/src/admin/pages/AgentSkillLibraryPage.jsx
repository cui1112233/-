import { Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { archiveAdminAgentSkill, createAdminAgentSkillDraft, getAdminAgentSkill, listAdminAgentSkills, publishAdminAgentSkill } from '../../shared/api/admin';

const blank = { id: '', name: '', description: '', category: '创作', inputTemplate: '', body: '' };

export function AgentSkillLibraryPage() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try { const result = await listAdminAgentSkills(); setSkills(result.skills || []); }
    catch (error) { message.error(error.message || '读取平台技能失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() { form.setFieldsValue(blank); setOpen(true); }
  async function openVersion(skill) {
    try { const result = await getAdminAgentSkill(skill.id, skill.version); form.setFieldsValue(result.skill); setOpen(true); }
    catch (error) { message.error(error.message || '读取技能失败'); }
  }
  async function save(values) {
    setSaving(true);
    try { await createAdminAgentSkillDraft(values); setOpen(false); await load(); message.success('已保存为草稿'); }
    catch (error) { message.error(error.message || '保存草稿失败'); }
    finally { setSaving(false); }
  }
  async function publish(skill) {
    try { await publishAdminAgentSkill(skill.id, skill.version); await load(); message.success('平台技能已发布'); }
    catch (error) { message.error(error.message || '发布失败'); }
  }
  async function archive(skill) {
    try { await archiveAdminAgentSkill(skill.id, skill.version); await load(); message.success('平台技能已归档'); }
    catch (error) { message.error(error.message || '归档失败'); }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 180 }, { title: 'ID', dataIndex: 'id', width: 190, ellipsis: true }, { title: '说明', dataIndex: 'description', ellipsis: true }, { title: '版本', dataIndex: 'version', width: 70 },
    { title: '状态', dataIndex: 'status', width: 90, render: value => <Tag color={value === 'published' ? 'green' : value === 'draft' ? 'gold' : 'default'}>{value === 'published' ? '已发布' : value === 'draft' ? '草稿' : '已归档'}</Tag> },
    { title: '操作', width: 250, render: (_, skill) => <Space size="small"><Button size="small" onClick={() => openVersion(skill)}>查看</Button>{skill.status === 'draft' ? <Popconfirm title="发布后所有用户可选择此技能" onConfirm={() => publish(skill)}><Button size="small" type="primary">发布</Button></Popconfirm> : null}{skill.status === 'published' ? <Popconfirm title="归档后普通用户将不能再选择此技能" onConfirm={() => archive(skill)}><Button size="small">归档</Button></Popconfirm> : null}</Space> }
  ];
  return <section className="admin-preset-library"><div className="admin-page-heading"><div><Typography.Title level={3}>CM 平台技能库</Typography.Title><Typography.Paragraph>平台技能正文仅由服务端在用户选用时调用，普通用户不可读取。</Typography.Paragraph></div><Button type="primary" onClick={openCreate}>新建平台技能</Button></div><Table rowKey={skill => `${skill.id}-${skill.version}`} loading={loading} columns={columns} dataSource={skills} pagination={false} /><Modal title="平台技能草稿" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnClose><Form form={form} layout="vertical" onFinish={save}><Form.Item label="技能 ID" name="id" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="名称" name="name" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="说明" name="description"><Input /></Form.Item><Form.Item label="分类" name="category"><Input /></Form.Item><Form.Item label="输入模板" name="inputTemplate"><Input.TextArea autoSize={{ minRows: 3 }} /></Form.Item><Form.Item label="技能规则" name="body" rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 9 }} /></Form.Item><Button htmlType="submit" type="primary" loading={saving}>保存草稿</Button></Form></Modal></section>;
}
