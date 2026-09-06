import {
  Alert,
  Button,
  Divider,
  Drawer,
  InputNumber,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography
} from 'antd';
import { CloudUpload, Save, Send, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import './batch-factory-v11-settings.css';

const DEFAULT_PUBLISH_SETTINGS = {
  configVersion: 'publish-v2.4',
  uploadVideoType: 'merged',
  mergeMode: 'current-merged',
  scrollCount: 3,
  generateCount: 10,
  materialReuse: true,
  horizontalFlip: false,
  decompressSpeed: 1,
  decompressPitch: 0,
  aiHead: true,
  txtUpload: true
};

function PublishField({ label, description, children }) {
  return <div className="bf11-setting-field">
    <div className="bf11-setting-field-copy">
      <Typography.Text strong>{label}</Typography.Text>
      {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
    </div>
    <div className="bf11-setting-field-control">{children}</div>
  </div>;
}

export function PublishSettingsDrawer({
  open,
  batch,
  initialValue = DEFAULT_PUBLISH_SETTINGS,
  onClose,
  onSave,
  onSync
}) {
  const [form, setForm] = useState(initialValue);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...DEFAULT_PUBLISH_SETTINGS, ...initialValue });
  }, [open, batch?.id]);

  function patch(next) {
    setForm(current => ({ ...current, ...next }));
  }

  function save() {
    onSave?.(form);
    onClose?.();
  }

  async function sync() {
    if (!onSync || syncing) return;
    setSyncing(true);
    try { await onSync(form); } finally { setSyncing(false); }
  }

  return <Drawer
    title={<Space><Send size={18} /><span>发布统一设置</span></Space>}
    width={760}
    open={open}
    onClose={onClose}
    destroyOnClose={false}
    extra={<Button type="primary" icon={<Save size={14} />} onClick={save}>保存发布统一设置</Button>}
  >
    <div className="bf11-settings-drawer">
      <div className="bf11-settings-scope">
        <div>
          <Typography.Text strong>当前批次发布参数</Typography.Text>
          <Typography.Text type="secondary">{batch?.title || '当前批次'} · 后续批量上传/发布统一使用</Typography.Text>
        </div>
        <Tag>{batch?.count || 0} 本小说</Tag>
      </div>

      <Divider orientation="left">发布配置版本</Divider>
      <section className="bf11-setting-section bf11-config-version-card">
        <div className="bf11-config-version-head">
          <div>
            <Typography.Text strong>版本配置</Typography.Text>
            <Typography.Text type="secondary">发布参数与生产参数分开冻结；后台更新不会静默覆盖当前批次。</Typography.Text>
          </div>
          <Tag color="green">当前 V2.4</Tag>
        </div>
        <div className="bf11-config-version-actions">
          <Select
            value={form.configVersion}
            onChange={configVersion => patch({ configVersion })}
            options={[
              { value: 'publish-v2.4', label: '发布配置 V2.4 · 当前' },
              { value: 'publish-v2.3', label: '发布配置 V2.3 · 历史' },
              { value: 'publish-v2.2', label: '发布配置 V2.2 · 历史' }
            ]}
          />
          <Button loading={syncing} icon={<CloudUpload size={14} />} onClick={sync}>同步批量后台配置</Button>
        </div>
      </section>

      <Divider orientation="left">上传 / 发布参数</Divider>
      <section className="bf11-setting-section">
        <PublishField label="上传视频类型" description="决定发布时上传最终合并成品还是独立视频。">
          <Segmented
            value={form.uploadVideoType}
            onChange={uploadVideoType => patch({ uploadVideoType })}
            options={[
              { value: 'merged', label: '合并成品' },
              { value: 'individual', label: '独立视频' }
            ]}
          />
        </PublishField>

        <PublishField label="合并方式" description="选择发布阶段使用哪一种合并产物。">
          <Select
            value={form.mergeMode}
            onChange={mergeMode => patch({ mergeMode })}
            options={[
              { value: 'current-merged', label: '使用当前已合并成品' },
              { value: 'manual-speed', label: '按固定倍率重新合并' },
              { value: 'follow-audio', label: '跟随音频时长合并' }
            ]}
          />
        </PublishField>

        <PublishField label="滚屏数量" description="当前批次发布时统一使用的滚屏数量。">
          <InputNumber min={0} max={100} value={form.scrollCount} onChange={scrollCount => patch({ scrollCount: Number(scrollCount || 0) })} />
        </PublishField>

        <PublishField label="生成数量" description="控制当前发布配置的目标生成数量。">
          <InputNumber min={1} max={1000} value={form.generateCount} onChange={generateCount => patch({ generateCount: Number(generateCount || 1) })} />
        </PublishField>

        <PublishField label="素材复用" description="打开后允许发布阶段按后台规则复用可复用素材。">
          <Space><Switch checked={form.materialReuse === true} onChange={materialReuse => patch({ materialReuse })} /><Tag>{form.materialReuse ? '复用' : '不复用'}</Tag></Space>
        </PublishField>

        <PublishField label="水平翻转" description="按发布规则对需要的素材执行水平翻转。">
          <Switch checked={form.horizontalFlip === true} onChange={horizontalFlip => patch({ horizontalFlip })} />
        </PublishField>

        <PublishField label="解压倍速" description="发布侧素材解压/处理使用的倍速参数。">
          <InputNumber min={0.1} max={5} step={0.1} value={form.decompressSpeed} onChange={decompressSpeed => patch({ decompressSpeed: Number(decompressSpeed || 1) })} addonAfter="x" />
        </PublishField>

        <PublishField label="解压音调" description="发布侧解压处理使用的音调参数。">
          <InputNumber min={-12} max={12} step={1} value={form.decompressPitch} onChange={decompressPitch => patch({ decompressPitch: Number(decompressPitch || 0) })} />
        </PublishField>

        <PublishField label="AI头部" description="是否按发布配置启用 AI 头部处理。">
          <Switch checked={form.aiHead === true} onChange={aiHead => patch({ aiHead })} />
        </PublishField>

        <PublishField label="TXT上传" description="是否随视频一起上传当前小说对应的 {bookId}.txt。">
          <Switch checked={form.txtUpload === true} onChange={txtUpload => patch({ txtUpload })} />
        </PublishField>
      </section>

      <Divider orientation="left">发布目标</Divider>
      <Alert
        type="info"
        showIcon
        icon={<Settings2 size={17} />}
        message="121 对接将在第三阶段完成"
        description="第一阶段只确认最终 UI；第二阶段完成批量工厂内部逻辑与上传链路；第三阶段再接 121 账号、凭据、真实提交、状态回传与审计。"
      />

      <Typography.Text type="secondary">真正发布成功以后才进入“已发布 / 已完成”终态；已合并不等于已完成。</Typography.Text>
    </div>
  </Drawer>;
}

export default PublishSettingsDrawer;
