import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Table, message } from 'antd';
import { createAssetTemplate, createAssetType, deleteAssetTemplate, deleteAssetType, listAssetTemplates, listAssetTypes } from '../../../shared/api/shuihuoProduction';

const categories = [
  { value: 'character', label: '人物' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' }
];

export function TemplateLibraryModal({ open, onClose }) {
  const [types, setTypes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [typeForm] = Form.useForm();
  const [templateForm] = Form.useForm();
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [typeResult, templateResult] = await Promise.all([listAssetTypes(), listAssetTemplates()]);
      setTypes(typeResult.assetTypes || []);
      setTemplates(templateResult.assetTemplates || []);
    } catch (error) {
      message.error(error.message || '读取角色模板失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) reload(); }, [open]);

  async function addType() {
    try {
      const values = await typeForm.validateFields();
      await createAssetType(values);
      typeForm.resetFields();
      await reload();
      message.success('角色类型已创建');
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '创建角色类型失败');
    }
  }

  async function addTemplate() {
    try {
      const values = await templateForm.validateFields();
      await createAssetTemplate(values);
      templateForm.resetFields();
      await reload();
      message.success('角色模板已创建');
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || '创建角色模板失败');
    }
  }

  async function removeType(id) {
    try { await deleteAssetType(id); await reload(); } catch (error) { message.error(error.message || '删除角色类型失败'); }
  }

  async function removeTemplate(id) {
    try { await deleteAssetTemplate(id); await reload(); } catch (error) { message.error(error.message || '删除角色模板失败'); }
  }

  return <Modal title="角色模板库" open={open} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} width={900}>
    <div className="shuihuo-template-layout">
      <section><h3>角色类型</h3><Form form={typeForm} layout="inline" initialValues={{ category: 'character' }}><Form.Item name="name" rules={[{ required: true, message: '请输入类型名称' }]}><Input placeholder="例如：主角" /></Form.Item><Form.Item name="category"><Select style={{ width: 100 }} options={categories} /></Form.Item><Button type="primary" onClick={addType}>新增类型</Button></Form>
        <div className="shuihuo-template-types">{types.map(type => <span key={type.id}>{type.name}<small>{categories.find(item => item.value === type.category)?.label}</small><Popconfirm title="删除该类型？系统类型不可删除。" onConfirm={() => removeType(type.id)}><Button type="link" danger size="small">删除</Button></Popconfirm></span>)}</div>
      </section>
      <section><h3>新建模板</h3><Form form={templateForm} layout="vertical" initialValues={{ source: 'manual' }}><Form.Item name="assetTypeId" label="类型" rules={[{ required: true, message: '请选择类型' }]}><Select options={types.map(type => ({ value: type.id, label: type.name }))} /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入模板名称' }]}><Input /></Form.Item><Form.Item name="prompt" label="视觉提示词"><Input.TextArea rows={3} /></Form.Item><Button type="primary" onClick={addTemplate}>保存模板</Button></Form></section>
    </div>
    <Table size="small" loading={loading} rowKey="id" pagination={false} dataSource={templates} columns={[
      { title: '名称', dataIndex: 'name' },
      { title: '类型', dataIndex: 'assetTypeId', render: id => types.find(type => type.id === id)?.name || '-' },
      { title: '视觉提示词', dataIndex: 'prompt', ellipsis: true },
      { title: '操作', render: (_, item) => <Popconfirm title="删除该模板？已应用到项目的资产不会删除。" onConfirm={() => removeTemplate(item.id)}><Button type="link" danger size="small">删除</Button></Popconfirm> }
    ]} />
  </Modal>;
}
