import { Button, Form, Input, Modal, Select, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

const dialogueModeOptions = [
  { value: 'auto', label: '自动识别 — 按剧情冲突、场景变化与叙事节奏切分' },
  { value: 'dual_dialogue', label: '中文双对话 — 优先按人物对白、配音时长和镜头节奏切分' }
];

export function CreateProjectModal({ open, loading, onClose, onCreate }) {
  const [form] = Form.useForm();
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setFileName('');
    }
  }, [form, open]);

  async function readSourceFile(file) {
    try {
      const sourceText = await file.text();
      form.setFieldsValue({ sourceText });
      setFileName(file.name);
      message.success(`已读取 ${file.name}`);
    } catch {
      message.error('文件读取失败，请改用粘贴文本。');
    }
    return false;
  }

  async function submit() {
    const values = await form.validateFields();
    onCreate({
      name: values.name.trim(),
      sourceText: values.sourceText || '',
      dialogueMode: values.dialogueMode
    });
  }

  return <Modal title="创建漫剧" open={open} onCancel={onClose} footer={null} width={680} destroyOnClose>
    <Form form={form} layout="vertical" onFinish={submit} initialValues={{ dialogueMode: 'auto' }}>
      <Form.Item name="name" label="作品名称" rules={[{ required: true, message: '请输入作品名称' }]}>
        <Input placeholder="例如：雨夜车站" maxLength={255} />
      </Form.Item>
      <Form.Item label="上传小说文件">
        <Upload beforeUpload={readSourceFile} accept=".txt,.srt,.vtt" maxCount={1} showUploadList={false}>
          <Button icon={<UploadOutlined />}>选择 TXT / SRT / VTT 文件</Button>
        </Upload>
        {fileName ? <div className="shuihuo-uploaded-file">已导入：{fileName}</div> : null}
      </Form.Item>
      <Form.Item name="sourceText" label="粘贴小说内容">
        <Input.TextArea placeholder="在此粘贴小说原文，也可先上传文件自动填充。" rows={12} />
      </Form.Item>
      <Form.Item name="dialogueMode" label="对话模式">
        <Select options={dialogueModeOptions} />
      </Form.Item>
      <div className="shuihuo-modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" htmlType="submit" loading={loading}>创建并进入分段</Button>
      </div>
    </Form>
  </Modal>;
}
