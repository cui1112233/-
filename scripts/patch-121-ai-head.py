from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    p = Path(path)
    text = p.read_text()
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected one regex match in {path}, got {count}')
    p.write_text(next_text)


frontend = 'frontend/src/user/pages/BatchFactoryPageV10.jsx'
replace_once(
    frontend,
    "  Typography,\n  message\n} from 'antd';",
    "  Typography,\n  Upload,\n  message\n} from 'antd';",
)
replace_once(
    frontend,
    "import { LeftOutlined, RightOutlined, SettingOutlined } from '@ant-design/icons';",
    "import { InboxOutlined, LeftOutlined, RightOutlined, SettingOutlined } from '@ant-design/icons';",
)
replace_once(
    frontend,
    "  updateBatchFactoryPublishSettings,\n",
    "  deleteBatchFactoryAiHead,\n  updateBatchFactoryPublishSettings,\n  uploadBatchFactoryAiHead,\n",
)

publish_component = r'''function PublishSettings({ open, batch, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [fileList, setFileList] = useState([]);
  const [saving, setSaving] = useState(false);

  function mapAssets(assets = []) {
    return assets.map(asset => ({
      uid: asset.id,
      name: asset.name,
      status: 'done',
      size: asset.size,
      serverAssetId: asset.id
    }));
  }

  useEffect(() => {
    if (!open) return;
    const publish = batch.publishSettings || {};
    const aiHeadMode = publish.aiHeadMode === 'custom' || publish.aiHead === '自定义AI头部' ? 'custom' : 'none';
    const assets = Array.isArray(publish.aiHeadAssets) ? publish.aiHeadAssets : [];
    setForm({ jieyaVideoCount: 4, materialReuse: false, horizontalFlip: false, ...publish, aiHeadMode });
    setFileList(mapAssets(assets));
  }, [open, batch?.id]);

  function patch(key, value) { setForm(current => ({ ...current, [key]: value })); }
  function chooseAiHead(value) { patch('aiHeadMode', value); }

  function beforeAiHeadUpload(file) {
    const isMp4 = file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '');
    if (!isMp4) {
      message.error(`${file.name || '文件'} 不是 MP4 视频`);
      return Upload.LIST_IGNORE;
    }
    return true;
  }

  async function uploadAiHead({ file, onSuccess, onError }) {
    try {
      const result = await uploadBatchFactoryAiHead(batch.id, file);
      const assets = result.assets || [];
      setForm(current => ({ ...current, aiHeadMode: 'custom', aiHeadAssets: assets }));
      setFileList(mapAssets(assets));
      onSuccess?.(result, file);
      message.success(`${file.name} 已保存到当前批次`);
    } catch (error) {
      onError?.(error);
      message.error(error.message || 'AI头部视频上传失败');
    }
  }

  async function removeAiHead(file) {
    if (!file.serverAssetId) return true;
    try {
      const result = await deleteBatchFactoryAiHead(batch.id, file.serverAssetId);
      const assets = result.assets || [];
      setForm(current => ({ ...current, aiHeadAssets: assets }));
      setFileList(mapAssets(assets));
      return true;
    } catch (error) {
      message.error(error.message || '删除AI头部视频失败');
      return false;
    }
  }

  async function save() {
    if (form.aiHeadMode === 'custom' && !(form.aiHeadAssets || []).length) {
      return message.warning('选择“自定义AI头部”后，请至少添加 1 个 MP4 头部视频');
    }
    setSaving(true);
    try {
      await updateBatchFactoryPublishSettings(batch.id, form);
      await onSaved();
      message.success('发布统一设置已保存');
      onClose();
    } catch (error) { message.error(error.message || '保存发布设置失败'); }
    finally { setSaving(false); }
  }

  const customAiHead = form.aiHeadMode === 'custom';
  return <Drawer title="发布统一设置" width={560} open={open} onClose={onClose} extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}>
    <Space direction="vertical" size={16} style={styles.full}>
      <Alert showIcon type="info" message="与 121「自定义文案 → 解压视频高级设置」保持一致" description="AI头部默认不添加；只有选择“自定义AI头部”时才出现 MP4 上传区。" />
      <Space><Typography.Text>解压视频数量</Typography.Text><InputNumber min={0} max={8} value={form.jieyaVideoCount ?? 4} onChange={value => patch('jieyaVideoCount', Number(value || 0))} /></Space>
      <div>
        <Typography.Text strong>AI头部</Typography.Text>
        <Select
          style={{ width: '100%', marginTop: 8 }}
          value={form.aiHeadMode || 'none'}
          onChange={chooseAiHead}
          options={[
            { value: 'none', label: '不加AI头部' },
            { value: 'custom', label: '自定义AI头部' }
          ]}
        />
      </div>
      {customAiHead ? <div>
        <Typography.Text strong>自定义AI头部视频</Typography.Text>
        <Typography.Text type="secondary">（可单传，可多传）</Typography.Text>
        <Upload.Dragger
          style={{ marginTop: 8 }}
          accept=".mp4,video/mp4"
          multiple
          fileList={fileList}
          beforeUpload={beforeAiHeadUpload}
          customRequest={uploadAiHead}
          onRemove={removeAiHead}
          showUploadList={{ showRemoveIcon: true }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击选择或拖拽AI头部视频</p>
          <p className="ant-upload-hint">仅支持 mp4，可多传</p>
        </Upload.Dragger>
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          视频保存到当前批次。切换回“不加AI头部”不会删除已上传文件，方便之后再次启用。
        </Typography.Paragraph>
      </div> : null}
      <Space><Switch checked={form.materialReuse === true} onChange={value => patch('materialReuse', value)} /><Typography.Text>素材复用</Typography.Text></Space>
      <Space><Switch checked={form.horizontalFlip === true} onChange={value => patch('horizontalFlip', value)} /><Typography.Text>水平翻转</Typography.Text></Space>
      <Input placeholder="121 配置 ID" value={form.configId || ''} onChange={event => patch('configId', event.target.value)} />
      <Input placeholder="121 档案 / profile ID" value={form.profileId || ''} onChange={event => patch('profileId', event.target.value)} />
      <Input placeholder="组织归属 ID" value={form.organizationId || ''} onChange={event => patch('organizationId', event.target.value)} />
    </Space>
  </Drawer>;
}

function MergePanel'''
regex_once(
    frontend,
    r'function PublishSettings\(\{ open, batch, onClose, onSaved \}\) \{.*?\n\}\n\nfunction MergePanel',
    publish_component,
)

api_file = 'frontend/src/shared/api/batchFactory.js'
marker = '''export function updateBatchFactoryPublishSettings(batchId, settings) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
}
'''
addition = marker + '''
export function uploadBatchFactoryAiHead(batchId, file) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-ai-heads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      'X-File-Name': encodeURIComponent(file.name || 'ai-head.mp4')
    },
    body: file
  });
}

export function deleteBatchFactoryAiHead(batchId, assetId) {
  return apiRequest(`${base}/batches/${encodeURIComponent(batchId)}/publish-ai-heads/${encodeURIComponent(assetId)}`, {
    method: 'DELETE'
  });
}
'''
replace_once(api_file, marker, addition)

controls = 'routes/batch-factory-controls.js'
controls_replacement = r'''function normalizePublishSettings(value = {}, previous = {}) {
  const rawCount = Number(value.jieyaVideoCount ?? previous.jieyaVideoCount ?? 4);
  const jieyaVideoCount = Number.isInteger(rawCount) ? Math.max(0, Math.min(8, rawCount)) : 4;
  const requestedAiHead = String(value.aiHeadMode ?? value.aiHead ?? previous.aiHeadMode ?? previous.aiHead ?? 'none').trim();
  const aiHeadMode = ['custom', '自定义AI头部', '添加AI头部'].includes(requestedAiHead) ? 'custom' : 'none';
  const aiHeadAssets = Array.isArray(previous.aiHeadAssets) ? previous.aiHeadAssets.slice(0, 20) : [];
  return {
    jieyaVideoCount,
    aiHeadMode,
    aiHead: aiHeadMode === 'custom' ? '自定义AI头部' : '不加AI头部',
    aiHeadAssets,
    materialReuse: boolOr(value.materialReuse, boolOr(previous.materialReuse, false)),
    horizontalFlip: boolOr(value.horizontalFlip, boolOr(previous.horizontalFlip, false)),
    profileId: text(value.profileId ?? previous.profileId, 160),
    organizationId: text(value.organizationId ?? previous.organizationId, 160),
    configId: text(value.configId ?? previous.configId, 160)
  };
}

function bumpVideoRevision'''
regex_once(
    controls,
    r'function normalizePublishSettings\(value = \{\}, previous = \{\}\) \{.*?\n\}\n\nfunction bumpVideoRevision',
    controls_replacement,
)

publish = 'routes/batch-factory-publish.js'
replace_once(
    publish,
    "const express = require('express');\n",
    "const express = require('express');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst crypto = require('node:crypto');\n",
)
replace_once(
    publish,
    "const target = require('../lib/target-upload');\n",
    "const target = require('../lib/target-upload');\nconst { ensureUserDir, getUserDir } = require('../lib/shared');\n",
)
helper_marker = "function clean(value) { return String(value ?? '').trim(); }\n"
helpers = helper_marker + r'''
const AI_HEAD_MAX_FILES = 20;
const AI_HEAD_MAX_BYTES = 200 * 1024 * 1024;

function safeAssetPart(value, label) {
  const normalized = clean(value);
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) throw new Error(`${label} 无效`);
  return normalized;
}

function aiHeadDirectory(username, batchId) {
  ensureUserDir(username);
  const directory = path.join(getUserDir(username), 'batch-factory-assets', safeAssetPart(batchId, '批次ID'), 'ai-heads');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function aiHeadFilePath(username, batchId, assetId) {
  return path.join(aiHeadDirectory(username, batchId), `${safeAssetPart(assetId, '素材ID')}.mp4`);
}

function normalizedAiHeadAssets(value) {
  return (Array.isArray(value) ? value : []).filter(asset => asset && typeof asset === 'object' && asset.id && asset.name).slice(0, AI_HEAD_MAX_FILES);
}

function looksLikeMp4(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const probe = buffer.subarray(0, Math.min(buffer.length, 128));
  const index = probe.indexOf(Buffer.from('ftyp'));
  return index >= 4 && index <= 64;
}
'''
replace_once(publish, helper_marker, helpers)

route_marker = "  router.get('/121/history', (req, res) => res.json({ history: store121.listHistory(req.username) }));\n"
routes = route_marker + r'''

  router.post('/batches/:batchId/publish-ai-heads', express.raw({ type: 'video/mp4', limit: AI_HEAD_MAX_BYTES }), (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    let fileName = clean(req.get('x-file-name') || 'ai-head.mp4');
    try { fileName = decodeURIComponent(fileName); } catch (_) {}
    fileName = path.basename(fileName).slice(0, 180);
    if (!/\.mp4$/i.test(fileName)) return res.status(400).json({ error: 'AI头部仅支持 MP4 视频' });
    if (!looksLikeMp4(req.body)) return res.status(400).json({ error: 'AI头部文件不是有效的 MP4 视频' });
    const assets = normalizedAiHeadAssets(batch.publishSettings?.aiHeadAssets);
    if (assets.length >= AI_HEAD_MAX_FILES) return res.status(409).json({ error: `单个批次最多保存 ${AI_HEAD_MAX_FILES} 个 AI头部视频` });
    const asset = {
      id: `aihead_${crypto.randomUUID().replace(/-/g, '')}`,
      name: fileName,
      size: req.body.length,
      createdAt: new Date().toISOString()
    };
    try {
      fs.writeFileSync(aiHeadFilePath(req.username, batch.id, asset.id), req.body);
      store.updateBatch(req.username, batch.id, targetBatch => {
        const previous = normalizedAiHeadAssets(targetBatch.publishSettings?.aiHeadAssets);
        targetBatch.publishSettings = {
          ...(targetBatch.publishSettings || {}),
          aiHeadMode: 'custom',
          aiHead: '自定义AI头部',
          aiHeadAssets: [...previous, asset]
        };
      });
      const next = store.getBatch(req.username, batch.id)?.publishSettings?.aiHeadAssets || [];
      return res.status(201).json({ asset, assets: next });
    } catch (error) {
      try { fs.unlinkSync(aiHeadFilePath(req.username, batch.id, asset.id)); } catch (_) {}
      return res.status(500).json({ error: error.message || '保存AI头部视频失败' });
    }
  });

  router.delete('/batches/:batchId/publish-ai-heads/:assetId', (req, res) => {
    const batch = store.getBatch(req.username, req.params.batchId);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const assetId = clean(req.params.assetId);
    const assets = normalizedAiHeadAssets(batch.publishSettings?.aiHeadAssets);
    if (!assets.some(asset => asset.id === assetId)) return res.status(404).json({ error: 'AI头部视频不存在' });
    try { fs.unlinkSync(aiHeadFilePath(req.username, batch.id, assetId)); } catch (error) {
      if (error?.code !== 'ENOENT') return res.status(500).json({ error: '删除AI头部视频失败' });
    }
    store.updateBatch(req.username, batch.id, targetBatch => {
      targetBatch.publishSettings = {
        ...(targetBatch.publishSettings || {}),
        aiHeadAssets: normalizedAiHeadAssets(targetBatch.publishSettings?.aiHeadAssets).filter(asset => asset.id !== assetId)
      };
    });
    return res.json({ ok: true, assets: store.getBatch(req.username, batch.id)?.publishSettings?.aiHeadAssets || [] });
  });
'''
replace_once(publish, route_marker, routes)

plan_marker = "  const organization = organizationSelection(config, batch.publishSettings || {});\n"
plan_guard = plan_marker + """  if (batch.publishSettings?.aiHeadMode === 'custom') {
    const aiHeadAssets = normalizedAiHeadAssets(batch.publishSettings?.aiHeadAssets);
    if (!aiHeadAssets.length) throw new Error(`小说 ${item.title} 已选择自定义AI头部，但当前批次没有AI头部视频`);
    throw new Error(`小说 ${item.title} 已选择自定义AI头部；121 页面已确认该模式需要额外上传 MP4，但当前还没有确认真实 multipart 字段名，因此暂不允许误发布`);
  }
"""
replace_once(publish, plan_marker, plan_guard)

test_file = 'test/batch-factory.test.js'
replace_once(
    test_file,
    "const { canonicalModelSettings } = require('../routes/batch-factory');\n",
    "const { canonicalModelSettings } = require('../routes/batch-factory');\nconst { normalizePublishSettings } = require('../routes/batch-factory-controls');\n",
)
append_marker = "test('服务端模型能力限制客户端选择秒数', () => {\n"
publish_test = r'''test('121发布AI头部默认不加，只有显式自定义才开启', () => {
  const defaults = normalizePublishSettings({}, {});
  assert.equal(defaults.aiHeadMode, 'none');
  assert.equal(defaults.aiHead, '不加AI头部');
  assert.deepEqual(defaults.aiHeadAssets, []);

  const previous = { aiHeadAssets: [{ id: 'aihead_demo', name: 'head.mp4', size: 123 }] };
  const custom = normalizePublishSettings({ aiHeadMode: 'custom' }, previous);
  assert.equal(custom.aiHeadMode, 'custom');
  assert.equal(custom.aiHead, '自定义AI头部');
  assert.equal(custom.aiHeadAssets.length, 1);
});

test('服务端模型能力限制客户端选择秒数', () => {
'''
replace_once(test_file, append_marker, publish_test)
