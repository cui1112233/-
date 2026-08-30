import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, message } from 'antd';
import { getProductionConfig, listModels, saveProductionConfig } from '../../../shared/api/shuihuoProduction';
import { withDefaultImageModel } from './modelDefaults';

const defaults = {
  characterPrefix: '', imagePrefix: '', imageSuffix: '', videoPrefix: '', videoSuffix: '',
  textModelId: null, imageModelId: null, videoModelId: null, audioModelId: null, jianyingDraftDirectory: ''
};

export function ProductionConfigModal({ open, onClose, onSaved }) {
  const [form] = Form.useForm();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([getProductionConfig(), listModels()]).then(([config, modelResult]) => {
      const nextModels = modelResult.models || modelResult || [];
      form.setFieldsValue(withDefaultImageModel({ ...defaults, ...config }, nextModels));
      setModels(nextModels);
    }).catch(error => message.error(error.message || '读取默认配置失败')).finally(() => setLoading(false));
  }, [open, form]);

  const optionsFor = kind => models.filter(model => model.kind === kind).map(model => ({ value: model.id, label: model.name }));

  async function submit() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await saveProductionConfig(values);
      message.success('默认配置已保存');
      onSaved?.(values);
      onClose();
    } catch (error) {
      message.error(error.message || '保存默认配置失败');
    } finally {
      setLoading(false);
    }
  }

  return <Modal title="生产默认配置" open={open} onCancel={onClose} width={760} footer={<><Button onClick={onClose}>取消</Button><Button type="primary" loading={loading} onClick={submit}>保存配置</Button></>}>
    <Form form={form} layout="vertical" initialValues={defaults} disabled={loading}>
      <Form.Item name="characterPrefix" label="角色提示词前缀"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <Form.Item name="imagePrefix" label="图片提示词前缀"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <Form.Item name="imageSuffix" label="图片提示词后缀"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <Form.Item name="videoPrefix" label="视频提示词前缀"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <Form.Item name="videoSuffix" label="视频提示词后缀"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
      <div className="shuihuo-config-models">
        <Form.Item name="textModelId" label="文本模型"><Select allowClear placeholder="未选择" options={optionsFor('text')} /></Form.Item>
        <Form.Item name="imageModelId" label="图片模型"><Select allowClear placeholder="未选择" options={optionsFor('image')} /></Form.Item>
        <Form.Item name="videoModelId" label="视频模型"><Select allowClear placeholder="未选择" options={optionsFor('video')} /></Form.Item>
        <Form.Item name="audioModelId" label="音频模型"><Select allowClear placeholder="未选择" options={optionsFor('audio')} /></Form.Item>
      </div>
      <Form.Item name="jianyingDraftDirectory" label="剪映草稿目录"><Input placeholder="阶段 C 导出时使用" /></Form.Item>
    </Form>
  </Modal>;
}
